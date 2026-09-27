(function(){
  const GIFJS_WORKER="gif.worker.js?v=1";
  const GIF_MAX_SIDE_DEFAULT=360;

  let tool=null;
  let state=null;
  let generation=0;
  let animationTimer=0;
  let previewBusy=false;
  const jpegWorkers=new WeakMap();

  function isGif(file){
    return !!file && (file.type==="image/gif" || /\.gif$/i.test(file.name||""));
  }

  function makeCanvas(w,h){
    const c=document.createElement("canvas");
    c.width=w;c.height=h;
    return c;
  }

  function processJpegFrame(toolConfig,frame){
    let pool=jpegWorkers.get(toolConfig);

    if(!pool){
      const worker=new Worker("jpeg-compresion-worker.js?v=5");
      pool={worker,busy:false,current:null,pending:[]};

      worker.onmessage=event=>{
        const data=event.data;

        if(data.type==="ready"){
          const task=pool.current;
          if(!task||!pool.busy)return;

          worker.postMessage({
            type:"render",
            token:1,
            compression:task.compression,
            blockSize:task.blockSize,
            acGain:task.acGain
          });
          return;
        }

        const task=pool.current;
        if(!task)return;

        if(data.type==="result"){
          pool.current=null;
          pool.busy=false;
          pool.pending.shift();

          const out=new Uint8ClampedArray(data.buffer);
          const result=makeCanvas(task.width,task.height);
          result.getContext("2d").putImageData(new ImageData(out,task.width,task.height),0,0);
          task.resolve(result);
          startJpegTask(pool);
          return;
        }

        if(data.type==="error"){
          pool.current=null;
          pool.busy=false;
          pool.pending.shift();
          task.reject(new Error(data.message||"No se pudo procesar el frame."));
          startJpegTask(pool);
        }
      };

      worker.onerror=error=>{
        const message=(error&&error.message)||"El worker de JPEG dejó de responder.";
        const current=pool.current;
        pool.current=null;
        pool.busy=false;
        if(current)current.reject(new Error(message));
        while(pool.pending.length){
          pool.pending.shift().reject(new Error(message));
        }
        try{worker.terminate();}catch(_){}
        jpegWorkers.delete(toolConfig);
      };

      jpegWorkers.set(toolConfig,pool);
    }

    const w=frame.width;
    const h=frame.height;
    const data=new Uint8ClampedArray(
      frame.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data
    );

    return new Promise((resolve,reject)=>{
      pool.pending.push({
        width:w,
        height:h,
        buffer:data.buffer,
        blockSize:Number(toolConfig.blockSize?.value||8),
        compression:Number(toolConfig.compression?.value||0),
        acGain:Number(toolConfig.acGain?.value||100),
        resolve,
        reject
      });

      startJpegTask(pool);
    });
  }

  function startJpegTask(pool){
    if(pool.busy||!pool.pending.length)return;

    const task=pool.pending[0];
    pool.current=task;
    pool.busy=true;

    pool.worker.postMessage({
      type:"init",
      width:task.width,
      height:task.height,
      blockSize:task.blockSize,
      buffer:task.buffer
    },[task.buffer]);
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
    setupProgress();
    if(tool.progressWrap)tool.progressWrap.style.display=value>0&&value<100?"block":"none";
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

  async function decodeGifuct(file,maxSide){
    if(typeof parseGIF!=="function"||typeof decompressFrames!=="function")throw new Error("No se pudo cargar el lector de GIF.");
    const buffer=await file.arrayBuffer();
    const parsed=parseGIF(buffer);
    const raw=decompressFrames(parsed,true);
    if(!raw.length)throw new Error("El GIF no contiene frames.");

    const logicalW=parsed.lsd.width,logicalH=parsed.lsd.height;
    const scale=Math.min(1,maxSide/Math.max(logicalW,logicalH));
    const w=Math.max(1,Math.round(logicalW*scale)),h=Math.max(1,Math.round(logicalH*scale));
    const composite=makeCanvas(w,h),cctx=composite.getContext("2d");
    let previousDisposal=0,previousDims=null,restoreCanvas=null;
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
    return {kind:"frames",frames,width:w,height:h};
  }

  async function openGif(file,maxSide){
    if(typeof ImageDecoder!=="undefined"){
      try{
        const buffer=await file.arrayBuffer();
        const decoder=new ImageDecoder({data:buffer,type:"image/gif"});
        await decoder.tracks.ready;
        const track=decoder.tracks.selectedTrack;
        if(track&&track.frameCount){
          const count=track.frameCount;
          const firstResult=await decoder.decode({frameIndex:0,completeFramesOnly:true});
          const firstImage=firstResult.image;
          const sourceW=firstImage.displayWidth||firstImage.codedWidth;
          const sourceH=firstImage.displayHeight||firstImage.codedHeight;
          const scale=Math.min(1,maxSide/Math.max(sourceW,sourceH));
          const w=Math.max(1,Math.round(sourceW*scale));
          const h=Math.max(1,Math.round(sourceH*scale));
          if(firstImage.close)firstImage.close();
          return {
            kind:"decoder",
            decoder,count,width:w,height:h,
            scale,
            durationCache:new Map()
          };
        }
        if(decoder.close)decoder.close();
      }catch(error){
        console.warn("ImageDecoder GIF fallback:",error);
      }
    }
    return decodeGifuct(file,maxSide);
  }

  async function getFrame(index){
    if(!state)return null;
    if(state.kind==="frames")return state.frames[index];
    const result=await state.decoder.decode({frameIndex:index,completeFramesOnly:true});
    const image=result.image;
    const c=makeCanvas(state.width,state.height);
    c.getContext("2d").drawImage(image,0,0,state.width,state.height);
    const duration=image.duration;
    if(!state.durationCache.has(index))state.durationCache.set(index,Number.isFinite(duration)?Math.max(20,Math.round(duration/1000)):100);
    if(image.close)image.close();
    return {canvas:c,delay:state.durationCache.get(index)||100};
  }

  async function processOne(index){
    const source=await getFrame(index);
    if(!source)return null;
    const processed=await tool.renderFrame(source.canvas,index,state.count);
    return {canvas:processed,delay:source.delay};
  }

  function stopPreview(){
    if(animationTimer)clearTimeout(animationTimer);
    animationTimer=0;
    generation++;
    if(state)state.generation=generation;
    previewBusy=false;
  }

  async function previewLoop(myGeneration,startIndex){
    if(previewBusy)return;
    previewBusy=true;
    let index=startIndex;
    try{
      while(state&&state.generation===myGeneration&&!state.exporting){
        const started=performance.now();
        const frame=await processOne(index);
        if(!state||state.generation!==myGeneration)return;
        showFrame(frame.canvas);
        state.previewIndex=(index+1)%state.count;
        const delay=Math.max(20,frame.delay||100);
        const spent=performance.now()-started;
        await new Promise(resolve=>{
          animationTimer=setTimeout(resolve,Math.max(0,delay-spent));
        });
        index=(index+1)%state.count;
      }
    }finally{
      previewBusy=false;
    }
  }

  async function refreshPreview(){
    if(!state||!state.readySources||state.exporting)return;
    stopPreview();
    const myGeneration=state.generation;
    try{
      const index=state.previewIndex%state.count;
      const frame=await processOne(index);
      if(!state||state.generation!==myGeneration)return;
      showFrame(frame.canvas);
      if(tool.fileName)tool.fileName.textContent=state.file.name+" · parámetro aplicado";
      previewLoop(myGeneration,(index+1)%state.count);
    }catch(error){
      console.error("NeoGif preview:",error);
    }
  }

  function schedulePreview(){
    if(!state||!state.readySources||state.exporting)return;
    clearTimeout(state.processTimer);
    state.processTimer=setTimeout(refreshPreview,100);
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
        data.data[i]=0;data.data[i+1]=255;data.data[i+2]=0;
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
    setProgress(1,state.file.name+" · preparando GIF…");

    let encoder=null;
    try{
      for(let i=0;i<state.count;i++){
        if(!state||state.generation!==myGeneration)return;
        const processed=await processOne(i);
        if(!state||state.generation!==myGeneration)return;

        if(!encoder){
          encoder=new GIF({
            workers:1,
            quality:35,
            width:processed.canvas.width,
            height:processed.canvas.height,
            repeat:0,
            workerScript:GIFJS_WORKER,
            dither:false,
            ...(tool.transparent?{transparent:0x00ff00}:{})
          });
        }

        const source=tool.transparent?keyTransparentCanvas(processed.canvas):processed.canvas;
        encoder.addFrame(source,{delay:processed.delay||100,copy:true});
        setProgress((i+1)/state.count*50,state.file.name+" · preparando GIF…");
        await new Promise(requestAnimationFrame);
      }

      if(!encoder)throw new Error("No se generó ningún frame.");

      encoder.on("progress",progress=>{
        if(state&&state.generation===myGeneration){
          setProgress(50+progress*50,state.file.name+" · codificando GIF… "+Math.round(progress*100)+"%");
        }
      });

      const finished=await new Promise((resolve,reject)=>{
        encoder.on("finished",resolve);
        encoder.on("abort",()=>reject(new Error("La codificación fue cancelada.")));
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
      console.error("NeoGif:",error);
      if(state&&state.generation===myGeneration){
        state.exporting=false;
        setProgress(0,state.file.name+" · no se pudo generar el GIF");
        tool.download.disabled=false;
        tool.download.textContent="DESCARGAR GIF ↓";
        const detail=error&&error.message ? " " + error.message : "";
        alert("No se pudo generar el GIF."+detail);
      }
    }
  }

  async function startGif(file){
    stopPreview();
    generation++;
    const myGeneration=generation;
    state={
      file,
      generation:myGeneration,
      kind:null,
      frames:null,
      decoder:null,
      count:0,
      width:0,
      height:0,
      durationCache:null,
      previewIndex:0,
      readySources:false,
      exporting:false,
      processTimer:0
    };
    setupProgress();
    if(tool.reset)tool.reset.disabled=false;
    tool.download.disabled=true;
    tool.download.textContent="CARGANDO GIF…";
    setProgress(1,file.name+" · cargando GIF…");

    try{
      const opened=await openGif(file,tool.gifMaxSide||GIF_MAX_SIDE_DEFAULT);
      if(!state||state.generation!==myGeneration)return;
      state.kind=opened.kind;
      state.width=opened.width;
      state.height=opened.height;
      if(opened.kind==="frames"){
        state.frames=opened.frames;
        state.count=opened.frames.length;
        state.durationCache=new Map();
      }else{
        state.decoder=opened.decoder;
        state.count=opened.count;
        state.durationCache=opened.durationCache;
      }
      if(!state.count)throw new Error("Sin frames.");
      state.readySources=true;
      tool.download.disabled=false;
      tool.download.textContent="DESCARGAR GIF ↓";
      setProgress(0,file.name+" · GIF cargado");
      const first=await processOne(0);
      if(!state||state.generation!==myGeneration)return;
      showFrame(first.canvas);
      state.previewIndex=1%state.count;
      previewLoop(myGeneration,state.previewIndex);
    }catch(error){
      console.error("NeoGif:",error);
      if(state&&state.decoder&&state.decoder.close)state.decoder.close();
      state=null;
      setProgress(0,"No se pudo procesar el GIF.");
      tool.download.disabled=true;
      tool.download.textContent=tool.normalDownloadLabel;
      alert("No se pudo procesar el GIF.");
    }
  }

  function clearGifState(){
    if(state&&state.decoder&&state.decoder.close)state.decoder.close();
    if(state&&state.processTimer)clearTimeout(state.processTimer);
    stopPreview();
    state=null;
    setProgress(0);
    if(tool){
      tool.download.textContent=tool.normalDownloadLabel;
      tool.download.disabled=true;
    }
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
      if(state&&state.decoder&&state.decoder.close)state.decoder.close();
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

  window.NeoGif={register,processJpegFrame};
})();