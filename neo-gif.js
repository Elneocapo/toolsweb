(function(){
  const GIFUCT_URL="https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/dist/gifuct.min.js";
  const GIFJS_WORKER="https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js";
  const GIF_MAX_SIDE_DEFAULT=640;
  let tool=null;
  let state=null;
  let animationTimer=0;
  let generation=0;

  const jpegPools=new WeakMap();

  function getJpegPool(tool){
    if(jpegPools.has(tool))return jpegPools.get(tool);
    const count=Math.min(4,Math.max(2,navigator.hardwareConcurrency||2));
    const pool={workers:[],queue:[],busy:0};
    for(let i=0;i<count;i++){
      const worker=new Worker("jpeg-compresion-worker.js?v=3");
      const slot={worker,busy:false,resolve:null,reject:null,ready:false};
      worker.onmessage=event=>{
        const data=event.data;
        if(data.type==="ready"){
          slot.ready=true;
          return;
        }
        if(data.type==="result"&&slot.resolve){
          const resolve=slot.resolve;
          slot.resolve=null;
          slot.reject=null;
          slot.busy=false;
          pool.busy--;
          resolve(new Uint8ClampedArray(data.buffer));
          pumpJpegPool(tool,pool);
          return;
        }
        if(data.type==="error"&&slot.reject){
          const reject=slot.reject;
          slot.resolve=null;
          slot.reject=null;
          slot.busy=false;
          pool.busy--;
          reject(new Error(data.message||"No se pudo procesar el frame."));
          pumpJpegPool(tool,pool);
        }
      };
      worker.onerror=error=>{
        if(slot.reject)slot.reject(error);
        slot.resolve=null;
        slot.reject=null;
        slot.busy=false;
      };
      pool.workers.push(slot);
    }
    jpegPools.set(tool,pool);
    return pool;
  }

  function pumpJpegPool(tool,pool){
    if(!pool.queue.length)return;
    const slot=pool.workers.find(item=>!item.busy);
    if(!slot)return;
    const task=pool.queue.shift();
    slot.busy=true;
    pool.busy++;
    slot.resolve=task.resolve;
    slot.reject=task.reject;
    slot.ready=false;
    slot.worker.postMessage({
      type:"init",
      width:task.width,
      height:task.height,
      buffer:task.buffer,
      blockSize:task.blockSize
    },[task.buffer]);
    const waitForReady=()=>{
      if(slot.resolve!==task.resolve)return;
      if(!slot.ready){requestAnimationFrame(waitForReady);return;}
      slot.worker.postMessage({
        type:"render",
        token:1,
        compression:task.compression,
        blockSize:task.blockSize,
        acGain:task.acGain
      });
    };
    waitForReady();
    pumpJpegPool(tool,pool);
  }

  function processJpegFrame(tool,frame){
    const w=frame.width,h=frame.height;
    const data=new Uint8ClampedArray(
      frame.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data
    );
    const pool=getJpegPool(tool);
    return new Promise((resolve,reject)=>{
      pool.queue.push({
        width:w,height:h,buffer:data.buffer,blockSize:Number(tool.blockSize?tool.blockSize.value:8)||8,
        compression:Number(tool.compression?tool.compression.value:0),
        acGain:Number(tool.acGain?tool.acGain.value:100),
        resolve,reject
      });
      pumpJpegPool(tool,pool);
    }).then(out=>{
      const result=makeCanvas(w,h);
      result.getContext("2d").putImageData(new ImageData(out,w,h),0,0);
      return result;
    });
  }

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
    if(tool.canvas.width!==frame.width||tool.canvas.height!==frame.height){
      tool.canvas.width=frame.width;
      tool.canvas.height=frame.height;
    }
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

  async function renderPreview(){
    if(!state||!tool||!tool.renderFrame)return;
    const myGeneration=state.generation;
    const index=Math.min(state.previewIndex||0,state.sources.length-1);

    try{
      const processed=await tool.renderFrame(state.sources[index].canvas,index,state.sources.length);
      if(!state||state.generation!==myGeneration)return;
      state.preview={canvas:processed,delay:state.sources[index].delay,index};
      state.previewIndex=index;
      showFrame(processed);

      if(tool.fileName)tool.fileName.textContent=state.file.name+" · "+state.sources.length+" frames · parámetro aplicado";
    }catch(error){
      console.error("NeoGif preview:",error);
      if(state&&state.generation===myGeneration){
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
      }
    }
  }

  async function processAllFrames(){
    if(!state||!tool||!tool.renderFrame)return null;
    const myGeneration=state.generation;
    const total=state.sources.length;
    const processed=new Array(total);
    const concurrency=Math.min(4,Math.max(2,navigator.hardwareConcurrency||2));
    let nextIndex=0;

    async function workerLoop(){
      while(true){
        if(!state||state.generation!==myGeneration)return false;
        const index=nextIndex++;
        if(index>=total)return true;
        const canvas=await tool.renderFrame(state.sources[index].canvas,index,total);
        if(!state||state.generation!==myGeneration)return false;
        processed[index]={canvas,delay:state.sources[index].delay};
        if(tool.fileName)tool.fileName.textContent=state.file.name+" · "+(index+1)+"/"+total+" frames";
      }
    }

    await Promise.all(Array.from({length:concurrency},()=>workerLoop()));
    if(!state||state.generation!==myGeneration)return null;
    return processed;
  }

  async function processForDownload(){
    if(!state||!tool)return;
    const myGeneration=state.generation;
    tool.download.disabled=true;
    tool.download.textContent="PROCESANDO GIF…";

    try{
      const processed=await processAllFrames();
      if(!processed||!state||state.generation!==myGeneration)return;
      state.processed=processed;
      state.ready=true;
      tool.download.textContent="GENERANDO GIF…";
      await encodeGif();
    }catch(error){
      console.error("NeoGif processing:",error);
      if(state&&state.generation===myGeneration){
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
      }
    }
  }

  function schedulePreview(){
    if(!state||!state.readySources)return;
    if(animationTimer)clearTimeout(animationTimer);
    clearTimeout(state.processTimer);
    state.generation=++generation;
    state.ready=false;
    state.processTimer=setTimeout(()=>renderPreview(),90);
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
      preview:null,
      previewIndex:0,
      readySources:false,
      ready:true,
      processTimer:0
    };
    tool.download.disabled=true;
    tool.download.textContent="CARGANDO GIF…";
    if(tool.reset)tool.reset.disabled=false;
    if(tool.fileName)tool.fileName.textContent=file.name+" · cargando GIF…";

    try{
      state.sources=await decode(file,tool.gifMaxSide||GIF_MAX_SIDE_DEFAULT);
      if(!state||state.generation!==generation)return;
      if(!state.sources.length)throw new Error("Sin frames.");
      state.readySources=true;
      if(tool.fileName)tool.fileName.textContent=file.name+" · "+state.sources.length+" frames";
      const initial=await processAllFrames();
      if(!initial||!state||state.generation!==generation)return;
      state.processed=initial;
      state.ready=true;
      if(state.processed.length)showFrame(state.processed[0].canvas);
      animate();
      tool.download.disabled=false;
      tool.download.textContent="DESCARGAR GIF ↓";
    }catch(error){
      console.error("NeoGif:",error);
      state=null;
      tool.download.disabled=true;
      tool.download.textContent=tool.normalDownloadLabel;
      if(tool.fileName)tool.fileName.textContent="No se pudo procesar el GIF.";
      alert("No se pudo procesar el GIF.");
    }
  }

  async function encodeGif(){
    if(!state||!state.processed.length||!tool)return;
    const myGeneration=state.generation;
    const first=state.processed[0].canvas;
    const options={
      workers:Math.min(4,Math.max(2,navigator.hardwareConcurrency||2)),
      quality:30,
      width:first.width,
      height:first.height,
      repeat:0,
      workerScript:GIFJS_WORKER,
      dither:false
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
    encoder.on("progress",progress=>{
      if(state&&state.generation===myGeneration&&tool.fileName){
        tool.fileName.textContent=state.file.name+" · exportando GIF · "+Math.round(progress*100)+"%";
      }
    });

    encoder.on("finished",blob=>{
      if(!state||state.generation!==myGeneration)return;
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      const base=(state.file.name||"imagen.gif").replace(/\.[^.]+$/,"");
      a.download=base+"-neotools.gif";
      a.href=url;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      tool.download.disabled=false;
      tool.download.textContent="DESCARGAR GIF ↓";
      if(tool.fileName)tool.fileName.textContent=state.file.name+" · GIF listo · "+state.processed.length+" frames";
    });
    encoder.render();
  }

  function downloadGif(){
    if(!state||!tool||!state.readySources)return;
    processForDownload();
  }

  function clearGifState(){
    generation++;
    if(animationTimer)clearTimeout(animationTimer);
    animationTimer=0;
    if(state&&state.processTimer)clearTimeout(state.processTimer);
    state=null;
    if(tool){
      tool.download.textContent=tool.normalDownloadLabel;
      tool.download.disabled=true;
    }
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
      if(animationTimer)clearTimeout(animationTimer);
      state=null;
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

  window.NeoGif={register,processJpegFrame};
})();