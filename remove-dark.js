const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),threshold=document.getElementById("threshold"),thresholdValue=document.getElementById("thresholdValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let sourceCanvas=null,currentFile=null,mode="image",frames=[],frameDelays=[],animationTimer=null;

function updateThresholdLabel(){thresholdValue.textContent=threshold.value+"%";}

function resetState(){
  if(animationTimer)clearTimeout(animationTimer);
  animationTimer=null;
  sourceCanvas=null;
  currentFile=null;
  mode="image";
  frames=[];
  frameDelays=[];
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  threshold.value=20;
  updateThresholdLabel();
  fileName.textContent="Ningún archivo seleccionado · Las imágenes salen en PNG y los GIF en GIF.";
}

function prepareCanvas(w,h){
  canvas.width=w;canvas.height=h;
  sourceCanvas=document.createElement("canvas");
  sourceCanvas.width=w;sourceCanvas.height=h;
  canvas.hidden=false;placeholder.hidden=true;download.disabled=false;reset.disabled=false;
}

function applyPixels(target){
  const targetCtx=target.getContext("2d",{willReadFrequently:true});
  const data=targetCtx.getImageData(0,0,target.width,target.height);
  const limit=Number(threshold.value)*2.55;
  for(let i=0;i<data.data.length;i+=4){
    const brightness=.299*data.data[i]+.587*data.data[i+1]+.114*data.data[i+2];
    if(brightness<=limit)data.data[i+3]=0;
  }
  targetCtx.putImageData(data,0,0);
}

function applyImage(){
  if(!sourceCanvas)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(sourceCanvas,0,0);
  applyPixels(canvas);
  updateThresholdLabel();
}

function loadImage(file){
  resetState();
  currentFile=file;
  mode="image";
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{
    const max=2200,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    prepareCanvas(w,h);
    sourceCanvas.getContext("2d").drawImage(img,0,0,w,h);
    applyImage();
    fileName.textContent=file.name+" · "+w+"×"+h;
    URL.revokeObjectURL(url);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);fileName.textContent="No se pudo abrir la imagen."};
  img.src=url;
}

async function loadGif(file){
  resetState();
  currentFile=file;
  mode="gif";
  fileName.textContent=file.name+" · procesando GIF…";
  try{
    const buffer=await file.arrayBuffer();
    const parsed=parseGIF(buffer);
    const raw=decompressFrames(parsed,true);
    if(!raw.length)throw new Error("El GIF no contiene frames.");

    const logicalW=parsed.lsd.width,logicalH=parsed.lsd.height;
    const scale=Math.min(1,360/Math.max(logicalW,logicalH));
    const w=Math.max(1,Math.round(logicalW*scale)),h=Math.max(1,Math.round(logicalH*scale));
    const composite=document.createElement("canvas");
    composite.width=w;composite.height=h;
    const cctx=composite.getContext("2d");
    let previousDisposal=0,previousDims=null,restoreCanvas=null;
    frames=[];frameDelays=[];

    for(const frame of raw){
      if(previousDisposal===2&&previousDims){
        cctx.clearRect(
          Math.round(previousDims.left*scale),Math.round(previousDims.top*scale),
          Math.max(1,Math.round(previousDims.width*scale)),Math.max(1,Math.round(previousDims.height*scale))
        );
      }else if(previousDisposal===3&&restoreCanvas){
        cctx.clearRect(0,0,w,h);
        cctx.drawImage(restoreCanvas,0,0);
      }

      let currentRestore=null;
      if(frame.disposalType===3){
        currentRestore=document.createElement("canvas");
        currentRestore.width=w;currentRestore.height=h;
        currentRestore.getContext("2d").drawImage(composite,0,0);
      }

      const patch=document.createElement("canvas");
      patch.width=frame.dims.width;patch.height=frame.dims.height;
      patch.getContext("2d").putImageData(new ImageData(frame.patch,frame.dims.width,frame.dims.height),0,0);
      cctx.drawImage(
        patch,
        Math.round(frame.dims.left*scale),Math.round(frame.dims.top*scale),
        Math.max(1,Math.round(frame.dims.width*scale)),Math.max(1,Math.round(frame.dims.height*scale))
      );

      const output=document.createElement("canvas");
      output.width=w;output.height=h;
      output.getContext("2d").drawImage(composite,0,0);
      applyPixels(output);
      frames.push(output);
      frameDelays.push(Math.max(20,Number(frame.delay)||100));

      previousDisposal=frame.disposalType||0;
      previousDims=frame.dims;
      restoreCanvas=currentRestore;
    }

    prepareCanvas(w,h);
    fileName.textContent=file.name+" · "+frames.length+" frames";
    renderGifFrame(0);
  }catch(error){
    console.error("REMOVE DARK GIF:",error);
    resetState();
    fileName.textContent="No se pudo procesar el GIF.";
  }
}

function renderGifFrame(index){
  if(mode!=="gif"||!frames.length)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(frames[index],0,0);
  if(animationTimer)clearTimeout(animationTimer);
  animationTimer=setTimeout(()=>renderGifFrame((index+1)%frames.length),frameDelays[index]||100);
}

function loadFile(file){
  if(!file)return;
  const type=file.type||"";
  if(type==="image/gif"||/\.gif$/i.test(file.name||""))loadGif(file);
  else if(type.startsWith("image/"))loadImage(file);
}

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
dropZone.addEventListener("click",e=>{if(e.target!==fileInput)fileInput.click()});
["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));

threshold.addEventListener("input",()=>{
  updateThresholdLabel();
  if(mode==="image")applyImage();
  else if(mode==="gif"&&frames.length){
    for(const frame of frames)applyPixels(frame);
    renderGifFrame(0);
  }
});

download.addEventListener("click",()=>{
  if(!currentFile)return;

  if(mode==="image"){
    const a=document.createElement("a");
    a.download="neotools-remove-dark.png";
    a.href=canvas.toDataURL("image/png");
    a.click();
    return;
  }

  if(mode==="gif"&&frames.length){
    download.disabled=true;
    fileName.textContent=currentFile.name+" · generando GIF…";

    try{
      const gif=new GIF({
        workers:1,
        quality:20,
        width:canvas.width,
        height:canvas.height,
        repeat:0,
        workerScript:"gif.worker.js?v=1",
        dither:false,
        transparent:0x00ff00
      });

      function makeTransparentFrame(source){
        const out=document.createElement("canvas");
        out.width=source.width;out.height=source.height;
        const octx=out.getContext("2d");
        octx.fillStyle="#00ff00";
        octx.fillRect(0,0,out.width,out.height);
        octx.drawImage(source,0,0);
        const data=octx.getImageData(0,0,out.width,out.height);
        for(let i=0;i<data.data.length;i+=4){
          if(data.data[i+3]<128){data.data[i]=0;data.data[i+1]=255;data.data[i+2]=0;}
          data.data[i+3]=255;
        }
        octx.putImageData(data,0,0);
        return out;
      }

      frames.forEach((frame,i)=>{
        gif.addFrame(makeTransparentFrame(frame),{delay:frameDelays[i]||100,copy:true});
      });

      gif.on("finished",blob=>{
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");
        a.download="neotools-remove-dark.gif";
        a.href=url;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1500);
        download.disabled=false;
        fileName.textContent=currentFile.name+" · GIF listo";
      });

      gif.on("abort",()=>{
        download.disabled=false;
        fileName.textContent=currentFile.name+" · exportación cancelada";
      });

      gif.render();
    }catch(error){
      console.error("REMOVE DARK GIF export:",error);
      download.disabled=false;
      fileName.textContent=currentFile.name+" · no se pudo exportar el GIF";
    }
  }
});

reset.addEventListener("click",()=>{fileInput.value="";resetState()});
updateThresholdLabel();