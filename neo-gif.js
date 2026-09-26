(function(){
  const GIFUCT_URL="https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/dist/gifuct.min.js";
  const GIFJS_WORKER="https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
  let tool=null;
  let state=null;
  let animationTimer=0;
  let generation=0;

  function isGif(file){
    return !!file && (file.type==="image/gif" || /\.gif$/i.test(file.name||""));
  }

  function makeCanvas(w,h){
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    return c;
  }

  async function decodeWithImageDecoder(file){
    if(typeof ImageDecoder==="undefined") return null;
    const buffer=await file.arrayBuffer();
    const decoder=new ImageDecoder({data:buffer,type:"image/gif"});
    await decoder.tracks.ready;
    const track=decoder.tracks.selectedTrack;
    if(!track||!track.frameCount)return null;

    const frames=[];
    for(let i=0;i<track.frameCount;i++){
      const result=await decoder.decode({frameIndex:i,completeFramesOnly:true});
      const image=result.image;
      const w=image.displayWidth||image.codedWidth;
      const h=image.displayHeight||image.codedHeight;
      const c=makeCanvas(w,h);
      c.getContext("2d").drawImage(image,0,0,w,h);
      const duration=image.duration;
      frames.push({canvas:c,delay:Number.isFinite(duration)?Math.max(20,Math.round(duration/1000)):100});
      if(image.close)image.close();
    }
    if(decoder.close)decoder.close();
    return frames;
  }

  async function decodeWithGifuct(file,maxSide){
    if(typeof parseGIF!=="function"||typeof decompressFrames!=="function"){
      throw new Error("No se pudo cargar el lector de GIF.");
    }
    const buffer=await file.arrayBuffer();
    const parsed=parseGIF(buffer);
    const raw=decompressFrames(parsed,true);
    if(!raw.length)throw new Error("El GIF no contiene frames.");

    const logicalW=parsed.lsd.width;
    const logicalH=parsed.lsd.height;
    const scale=Math.min(1,maxSide/Math.max(logicalW,logicalH));
    const w=Math.max(1,Math.round(logicalW*scale));
    const h=Math.max(1,Math.round(logicalH*scale));

    const composite=makeCanvas(w,h);
    const cctx=composite.getContext("2d");
    let previousDisposal=0;
    let previousDims=null;
    let restoreCanvas=null;
    const frames=[];

    for(const frame of raw){
      if(previousDisposal===2&&previousDims){
        cctx.clearRect(
          Math.round(previousDims.left*scale),
          Math.round(previousDims.top*scale),
          Math.round(previousDims.width*scale),
          Math.round(previousDims.height*scale)
        );
      }else if(previousDisposal===3&&restoreCanvas){
        cctx.clearRect(0,0,w,h);
        cctx.drawImage(restoreCanvas,0,0);
      }

      let currentRestore=null;
      if(frame.disposalType===3){
        currentRestore=makeCanvas(w,h);
        currentRestore.getContext("2d").drawImage(composite,0,0);
      }

      const patch=makeCanvas(frame.dims.width,frame.dims.height);
      patch.getContext("2d").putImageData(
        new ImageData(frame.patch,frame.dims.width,frame.dims.height),0,0
      );

      cctx.drawImage(
        patch,
        Math.round(frame.dims.left*scale),
        Math.round(frame.dims.top*scale),
        Math.max(1,Math.round(frame.dims.width*scale)),
        Math.max(1,Math.round(frame.dims.height*scale))
      );

      const snapshot=makeCanvas(w,h);
      snapshot.getContext("2d").drawImage(composite,0,0);
      frames.push({
        canvas:snapshot,
        delay:Math.max(20,Number(frame.delay)||100),
        disposal:frame.disposalType||0
      });

      previousDisposal=frame.disposalType||0;
      previousDims=frame.dims;
      restoreCanvas=currentRestore;
    }

    return frames.map(f=>({canvas:f.canvas,delay:f.delay}));
  }

  async function decode(file,maxSide){
    try{
      const decoded=await decodeWithImageDecoder(file);
      if(decoded&&decoded.length)return decoded;
    }catch(error){
      console.warn("ImageDecoder GIF fallback:",error);
    }
    return decodeWithGifuct(file,maxSide);
  }

  function copyCanvas(source){
    const target=makeCanvas(source.width,source.height);
    target.getContext("2d").drawImage(source,0,0);
    return target;
  }

  function showFrame(frame){
    if(!tool||!frame)return;
    tool.canvas.width=frame.width;
    tool.canvas.height=frame.height;
    tool.ctx.clearRect(0,0,frame.width,frame.height);
    tool.ctx.drawImage(frame,0,0);
    tool.canvas.hidden=false;
    if(tool.placeholder)tool.placeholder.hidden=true;
  }

  function animate(){
    if(!state||!state.processed.length)return;
    if(animationTimer)clearTimeout(animationTimer);
    let i=0;
    const tick=()=>{
      if(!state)return;
      const frame=state.processed[i];
      showFrame(frame.canvas);
      animationTimer=setTimeout(()=>{
        i=(i+1)%state.processed.length;
        tick();
      },state.processed[i].delay||100);
    };
    tick();
  }

  async function processFrames(){
    if(!state||!tool||!tool.renderFrame)return;
    const myGeneration=state.generation;
    state.processed=[];
    tool.download.disabled=true;
    tool.download.textContent="PROCESANDO GIF…";
    for(let i=0;i<state.sources.length;i++){
      if(!state||state.generation!==myGeneration)return;
      const processed=await tool.renderFrame(state.sources[i].canvas,i,state.sources.length);
      if(!state||state.generation!==myGeneration)return;
      state.processed.push({canvas:processed,delay:state.sources[i].delay});
      if(i===0)showFrame(processed);
    }
    if(!state||state.generation!==myGeneration)return;
    state.ready=true;
    tool.download.disabled=false;
    tool.download.textContent="DESCARGAR GIF ↓";
    animate();
  }

  function scheduleProcess(){
    if(!state||!state.readySources)return;
    generation++;
    state.generation=generation;
    state.ready=false;
    clearTimeout(state.processTimer);
    state.processTimer=setTimeout(()=>processFrames(),80);
  }

  async function startGif(file){
    if(!tool||!isGif(file))return;
    generation++;
    if(animationTimer)clearTimeout(animationTimer);
    state={
      file,
      generation,
      sources:[],
      processed:[],
      readySources:false,
      ready:false,
      processTimer:0
    };
    tool.download.disabled=true;
    tool.download.textContent="CARGANDO GIF…";
    if(tool.reset)tool.reset.disabled=false;
    if(tool.fileName)tool.fileName.textContent=file.name+" · cargando GIF…";

    try{
      state.sources=await decode(file,tool.maxSide||1000);
      if(!state||state.generation!==generation)return;
      if(!state.sources.length)throw new Error("Sin frames.");
      state.readySources=true;
      if(tool.fileName)tool.fileName.textContent=file.name+" · "+state.sources.length+" frames";
      await processFrames();
    }catch(error){
      console.error("NeoGif:",error);
      state=null;
      tool.download.disabled=true;
      tool.download.textContent=tool.normalDownloadLabel;
      if(tool.fileName)tool.fileName.textContent="No se pudo procesar el GIF.";
      alert("No se pudo procesar el GIF.");
    }
  }

  function downloadGif(){
    if(!state||!state.ready||!state.processed.length||!tool)return;
    tool.download.disabled=true;
    tool.download.textContent="GENERANDO GIF…";

    const first=state.processed[0].canvas;
    const options={
      workers:2,
      quality:10,
      width:first.width,
      height:first.height,
      repeat:0,
      workerScript:GIFJS_WORKER
    };
    if(tool.transparent)options.transparent=0x00ff00;

    const encoder=new GIF(options);
    state.processed.forEach((frame)=>{
      let source=frame.canvas;
      if(tool.transparent){
        const keyed=makeCanvas(source.width,source.height);
        const kctx=keyed.getContext("2d");
        kctx.fillStyle="#00ff00";
        kctx.fillRect(0,0,keyed.width,keyed.height);
        kctx.drawImage(source,0,0);
        const data=kctx.getImageData(0,0,keyed.width,keyed.height);
        for(let i=0;i<data.data.length;i+=4){
          if(data.data[i+3]<128){
            data.data[i]=0;data.data[i+1]=255;data.data[i+2]=0;
          }
          data.data[i+3]=255;
        }
        kctx.putImageData(data,0,0);
        source=keyed;
      }
      encoder.addFrame(source,{delay:frame.delay||100,copy:true});
    });
    encoder.on("finished",blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      const base=(state.file.name||"imagen.gif").replace(/\.[^.]+$/,"");
      a.download=base+"-neotools.gif";
      a.href=url;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      if(state){
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
      }
    });
    encoder.render();
  }

  function register(config){
    tool=Object.assign({
      maxSide:1000,
      transparent:false
    },config);
    tool.normalDownloadLabel=tool.download.textContent;

    tool.fileInput.addEventListener("change",event=>{
      const file=event.target.files&&event.target.files[0];
      if(isGif(file)){
        event.preventDefault();
        event.stopImmediatePropagation();
        startGif(file);
      }
    },true);

    tool.dropZone.addEventListener("drop",event=>{
      const file=event.dataTransfer.files&&event.dataTransfer.files[0];
      if(isGif(file)){
        event.preventDefault();
        event.stopImmediatePropagation();
        startGif(file);
      }
    },true);

    tool.download.addEventListener("click",event=>{
      if(state&&state.ready){
        event.preventDefault();
        event.stopImmediatePropagation();
        downloadGif();
      }
    },true);

    tool.reset.addEventListener("click",()=>{
      generation++;
      if(animationTimer)clearTimeout(animationTimer);
      state=null;
      tool.download.textContent=tool.normalDownloadLabel;
    },true);

    document.addEventListener("input",event=>{
      if(state&&state.readySources&&event.target!==tool.fileInput&&event.target!==tool.download){
        event.preventDefault();
        event.stopImmediatePropagation();
        state.ready=false;
        clearTimeout(state.processTimer);
        state.generation=++generation;
        state.processTimer=setTimeout(()=>processFrames(),80);
      }
    },true);

    document.addEventListener("change",event=>{
      if(state&&state.readySources&&event.target!==tool.fileInput){
        event.preventDefault();
        event.stopImmediatePropagation();
        state.ready=false;
        clearTimeout(state.processTimer);
        state.generation=++generation;
        state.processTimer=setTimeout(()=>processFrames(),80);
      }
    },true);

    document.addEventListener("click",event=>{
      if(state&&state.readySources&&event.target.closest&&event.target.closest(".pattern")){
        setTimeout(()=>scheduleProcess(),0);
      }
    },true);
  }

  window.NeoGif={register};
})();