(function(){
  const GIFJS_WORKER="https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
  const GIF_MAX_SIDE_DEFAULT=480;
  let tool=null;
  let state=null;
  let generation=0;
  let animationTimer=0;
  let previewBusy=false;

  function isGif(file){
    return !!file && (file.type==="image/gif" || /\.gif$/i.test(file.name||""));
  }

  function makeCanvas(w,h){
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    return c;
  }

  function setupProgress(){
    if(!tool)return;
    const info=tool.fileName&&tool.fileName.parentElement;
    if(!info)return;
    let wrap=info.parentElement.querySelector(".neo-gif-progress");
    if(wrap)return;
    wrap=document.createElement("div");
    wrap.className="neo-gif-progress";
    wrap.style.cssText="display:none;margin-top:7px;height:4px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.08)";
    const bar=document.createElement("div");
    bar.className="neo-gif-progress-bar";
    bar.style.cssText="width:0%;height:100%;transform-origin:left center;transition:width .12s linear;background:currentColor";
    wrap.appendChild(bar);
    info.insertAdjacentElement("beforebegin",wrap);
    tool.progressWrap=wrap;
    tool.progressBar=bar;
  }

  function setProgress(value,label){
    if(!tool)return;
    setupProgress();
    if(tool.progressWrap)tool.progressWrap.style.display=value<=0||value>=100?"none":"block";
    if(tool.progressBar)tool.progressBar.style.width=Math.max(0,Math.min(100,value))+"%";
    if(tool.fileName&&label)tool.fileName.textContent=label;
  }

  function showFrame(frame){
    if(!tool||!frame)return;
    if(tool.canvas.width!==frame.width||tool.canvas.height!==frame.height){
      tool.canvas.width=frame.width;
      tool.canvas.height=frame.height;
    }
    tool.ctx.clearRect(0,0,frame.width,frame.height);
    tool.ctx.drawImage(frame,0,0);
    tool.canvas.hidden=false;
    if(tool.placeholder)tool.placeholder.hidden=true;
  }

  async function decodeWithImageDecoder(file){
    if(typeof ImageDecoder==="undefined")return null;
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
    if(typeof parseGIF!=="function"||typeof decompressFrames!=="function")throw new Error("No se pudo cargar el lector de GIF.");
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
      patch.getContext("2d").putImageData(new ImageData(frame.patch,frame.dims.width,frame.dims.height),0,0);
      cctx.drawImage(
        patch,
        Math.round(frame.dims.left*scale),
        Math.round(frame.dims.top*scale),
        Math.max(1,Math.round(frame.dims.width*scale)),
        Math.max(1,Math.round(frame.dims.height*scale))
      );

      const snapshot=makeCanvas(w,h);
      snapshot.getContext("2d").drawImage(composite,0,0);
      frames.push({canvas:snapshot,delay:Math.max(20,Number(frame.delay)||100)});

      previousDisposal=frame.disposalType||0;
      previousDims=frame.dims;
      restoreCanvas=currentRestore;
    }
    return frames;
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

  async function processOne(index){
    if(!state||!tool)return null;
    const source=state.sources[index];
    if(!source)return null;
    return tool.renderFrame(source.canvas,index,state.sources.length);
  }

  async function previewLoop(myGeneration,index){
    if(previewBusy)return;
    previewBusy=true;
    try{
      while(state&&state.generation===myGeneration&&state.sources.length){
        const i=index%state.sources.length;
        const started=performance.now();
        const frame=await processOne(i);
        if(!state||state.generation!==myGeneration)return;
        showFrame(frame);
        state.previewIndex=(i+1)%state.sources.length;
        const delay=Math.max(20,state.sources[i].delay||100);
        const spent=performance.now()-started;
        await new Promise(resolve=>{
          animationTimer=setTimeout(resolve,Math.max(0,delay-spent));
        });
        index++;
      }
    }finally{
      previewBusy=false;
    }
  }

  function stopPreview(){
    if(animationTimer)clearTimeout(animationTimer);
    animationTimer=0;
    generation++;
    if(state)state.generation=generation;
    previewBusy=false;
  }

  async function refreshPreview(){
    if(!state||!state.readySources)return;
    stopPreview();
    const myGeneration=state.generation;
    try{
      const index=state.previewIndex%state.sources.length;
      const frame=await processOne(index);
      if(!state||state.generation!==myGeneration)return;
      showFrame(frame);
      if(tool.fileName)tool.fileName.textContent=state.file.name+" · parámetro aplicado";
      previewLoop(myGeneration,(index+1)%state.sources.length);
    }catch(error){
      console.error("NeoGif preview:",error);
    }
  }

  async function startGif(file){
    stopPreview();
    generation++;
    const myGeneration=generation;
    state={
      file,
      generation:myGeneration,
      sources:[],
      previewIndex:0,
      readySources:false,
      processTimer:0,
      exporting:false
    };
    setupProgress();
    if(tool.reset)tool.reset.disabled=false;
    if(tool.download){
      tool.download.disabled=true;
      tool.download.textContent="CARGANDO GIF…";
    }
    setProgress(1,file.name+" · cargando GIF…");

    try{
      state.sources=await decode(file,tool.gifMaxSide||GIF_MAX_SIDE_DEFAULT);
      if(!state||state.generation!==myGeneration)return;
      if(!state.sources.length)throw new Error("Sin frames.");
      state.readySources=true;
      state.previewIndex=0;
      setProgress(0,file.name+" · GIF cargado");
      if(tool.download){
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
      }
      const first=await processOne(0);
      if(!state||state.generation!==myGeneration)return;
      showFrame(first);
      state.previewIndex=1%state.sources.length;
      previewLoop(myGeneration,state.previewIndex);
    }catch(error){
      console.error("NeoGif:",error);
      state=null;
      setProgress(0,"No se pudo procesar el GIF.");
      if(tool.download){
        tool.download.disabled=true;
        tool.download.textContent=tool.normalDownloadLabel;
      }
      alert("No se pudo procesar el GIF.");
    }
  }

  function keyTransparentCanvas(source){
    const keyed=makeCanvas(source.width,source.height);
    const kctx=keyed.getContext("2d");
    kctx.fillStyle="#00ff00";
    kctx.fillRect(0,0,keyed.width,keyed.height);
    kctx.drawImage(source,0,0);
    const data=kctx.getImageData(0,0,keyed.width,keyed.height);
    for(let i=0;i<data.data.length;i+=4){
      if(data.data[i+3]<128){
        data.data[i]=0;
        data.data[i+1]=255;
        data.data[i+2]=0;
      }
      data.data[i+3]=255;
    }
    kctx.putImageData(data,0,0);
    return keyed;
  }

  async function downloadGif(){
    if(!state||!state.readySources||state.exporting)return;
    stopPreview();
    const myGeneration=state.generation;
    state.exporting=true;
    tool.download.disabled=true;
    tool.download.textContent="PROCESANDO GIF…";

    const sources=state.sources;
    let encoder=null;
    try{
      encoder=null;
      for(let i=0;i<sources.length;i++){
        if(!state||state.generation!==myGeneration)return;
        const processed=await processOne(i);
        if(!state||state.generation!==myGeneration)return;

        if(!encoder){
          encoder=new GIF({
            workers:Math.min(2,Math.max(1,navigator.hardwareConcurrency||1)),
            quality:30,
            width:processed.width,
            height:processed.height,
            repeat:0,
            workerScript:GIFJS_WORKER,
            dither:false,
            ...(tool.transparent?{transparent:0x00ff00}:{})
          });
          encoder.on("progress",progress=>{
            if(state&&state.generation===myGeneration){
              setProgress(50+progress*50,state.file.name+" · codificando GIF… "+Math.round(progress*100)+"%");
            }
          });
        }

        const frameSource=tool.transparent?keyTransparentCanvas(processed):processed;
        encoder.addFrame(frameSource,{delay:sources[i].delay||100,copy:true});
        setProgress(((i+1)/sources.length)*50,state.file.name+" · procesando GIF…");
        await new Promise(requestAnimationFrame);
      }

      if(!encoder)throw new Error("No se generó ningún frame.");
      if(tool.fileName)tool.fileName.textContent=state.file.name+" · codificando GIF…";
      const finished=await new Promise((resolve,reject)=>{
        encoder.on("finished",resolve);
        encoder.on("abort",()=>reject(new Error("La codificación del GIF fue cancelada.")));
        encoder.render();
      });
      if(!state||state.generation!==myGeneration)return;

      const url=URL.createObjectURL(finished);
      const a=document.createElement("a");
      const base=(state.file.name||"imagen.gif").replace(/\.[^.]+$/,"");
      a.download=base+"-neotools.gif";
      a.href=url;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);

      setProgress(0,state.file.name+" · GIF listo");
      tool.download.disabled=false;
      tool.download.textContent="DESCARGAR GIF ↓";
      state.exporting=false;
    }catch(error){
      console.error("NeoGif download:",error);
      if(state&&state.generation===myGeneration){
        state.exporting=false;
        setProgress(0,state.file.name+" · exportación cancelada");
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
        alert("No se pudo generar el GIF. Prueba con un GIF más pequeño o con menos resolución.");
      }
    }
  }

  function clearGifState(){
    stopPreview();
    if(state&&state.exporting)state.exporting=false;
    state=null;
    setProgress(0);
    if(tool){
      tool.download.textContent=tool.normalDownloadLabel;
      tool.download.disabled=true;
    }
  }

  function schedulePreview(){
    if(!state||!state.readySources||state.exporting)return;
    clearTimeout(state.processTimer);
    state.processTimer=setTimeout(()=>refreshPreview(),100);
  }

  function register(config){
    tool=Object.assign({maxSide:1000,transparent:false},config);
    tool.normalDownloadLabel=tool.download.textContent;
    setupProgress();

    tool.fileInput.addEventListener("change",event=>{
      const file=event.target.files&&event.target.files[0];
      if(isGif(file)){
        event.preventDefault();
        event.stopImmediatePropagation();
        startGif(file);
      }else{
        clearGifState();
      }
    },true);

    tool.dropZone.addEventListener("drop",event=>{
      const file=event.dataTransfer.files&&event.dataTransfer.files[0];
      if(isGif(file)){
        event.preventDefault();
        event.stopImmediatePropagation();
        startGif(file);
      }else{
        clearGifState();
      }
    },true);

    tool.download.addEventListener("click",event=>{
      if(state&&state.readySources){
        event.preventDefault();
        event.stopImmediatePropagation();
        downloadGif();
      }
    },true);

    tool.reset.addEventListener("click",()=>{
      generation++;
      stopPreview();
      state=null;
      setProgress(0);
      tool.download.textContent=tool.normalDownloadLabel;
    },true);

    document.addEventListener("input",event=>{
      if(state&&state.readySources&&event.target!==tool.fileInput&&event.target!==tool.download){
        schedulePreview();
      }
    },true);

    document.addEventListener("change",event=>{
      if(state&&state.readySources&&event.target!==tool.fileInput){
        schedulePreview();
      }
    },true);
  }

  window.NeoGif={register};
})();