const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const threshold=document.getElementById("threshold");
const thresholdValue=document.getElementById("thresholdValue");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

const MAX_SIDE=2200;
const GIF_PREVIEW_SIDE=700;

let sourceCanvas=null;
let currentFile=null;
let mode="image";
let gifImage=null;
let gifObjectUrl=null;
let gifPreviewTimer=0;
let frames=[];
let frameDelays=[];

function updateThresholdLabel(){
  thresholdValue.textContent=threshold.value+"%";
}

function stopGifPreview(){
  if(gifPreviewTimer)clearTimeout(gifPreviewTimer);
  gifPreviewTimer=0;
}

function resetState(){
  stopGifPreview();
  if(gifObjectUrl){
    URL.revokeObjectURL(gifObjectUrl);
    gifObjectUrl=null;
  }
  sourceCanvas=null;
  currentFile=null;
  mode="image";
  gifImage=null;
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

function prepareCanvas(w,h){
  canvas.width=w;
  canvas.height=h;
  canvas.hidden=false;
  placeholder.hidden=true;
  download.disabled=false;
  reset.disabled=false;
}

function drawSourceImage(){
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

  const img=new Image();
  const url=URL.createObjectURL(file);

  img.onload=()=>{
    try{
      const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
      const w=Math.max(1,Math.round(img.naturalWidth*scale));
      const h=Math.max(1,Math.round(img.naturalHeight*scale));

      prepareCanvas(w,h);
      sourceCanvas=document.createElement("canvas");
      sourceCanvas.width=w;
      sourceCanvas.height=h;
      sourceCanvas.getContext("2d").drawImage(img,0,0,w,h);

      drawSourceImage();
      fileName.textContent=file.name+" · "+w+"×"+h;
    }catch(error){
      console.error("REMOVE DARK image:",error);
      fileName.textContent="No se pudo abrir la imagen.";
    }finally{
      URL.revokeObjectURL(url);
    }
  };

  img.onerror=()=>{
    URL.revokeObjectURL(url);
    fileName.textContent="No se pudo abrir la imagen.";
  };

  img.src=url;
}

function previewGifFrame(){
  if(mode!=="gif"||!gifImage)return;

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(gifImage,0,0,canvas.width,canvas.height);
  applyPixels(canvas);

  if(mode==="gif"){
    gifPreviewTimer=setTimeout(previewGifFrame,50);
  }
}

function loadGifPreview(file){
  resetState();
  currentFile=file;
  mode="gif";
  frames=[];
  frameDelays=[];

  gifObjectUrl=URL.createObjectURL(file);
  gifImage=new Image();

  gifImage.onload=()=>{
    const scale=Math.min(
      1,
      GIF_PREVIEW_SIDE/Math.max(gifImage.naturalWidth,gifImage.naturalHeight)
    );
    const w=Math.max(1,Math.round(gifImage.naturalWidth*scale));
    const h=Math.max(1,Math.round(gifImage.naturalHeight*scale));

    prepareCanvas(w,h);
    fileName.textContent=file.name+" · GIF animado";
    previewGifFrame();

    decodeGifForDownload(file);
  };

  gifImage.onerror=()=>{
    if(gifObjectUrl)URL.revokeObjectURL(gifObjectUrl);
    gifObjectUrl=null;
    gifImage=null;
    mode="image";
    fileName.textContent="No se pudo abrir el GIF.";
    canvas.hidden=true;
    placeholder.hidden=false;
    download.disabled=true;
    reset.disabled=true;
  };

  gifImage.src=gifObjectUrl;
}

async function decodeGifForDownload(file){
  try{
    if(typeof parseGIF!=="function"||typeof decompressFrames!=="function"){
      throw new Error("Lector GIF no disponible.");
    }

    const buffer=await file.arrayBuffer();
    const parsed=parseGIF(buffer);
    const raw=decompressFrames(parsed,true);
    if(!raw.length)throw new Error("El GIF no contiene frames.");

    const logicalW=parsed.lsd.width;
    const logicalH=parsed.lsd.height;
    const scale=Math.min(1,GIF_PREVIEW_SIDE/Math.max(logicalW,logicalH));
    const w=Math.max(1,Math.round(logicalW*scale));
    const h=Math.max(1,Math.round(logicalH*scale));

    const composite=document.createElement("canvas");
    composite.width=w;
    composite.height=h;
    const cctx=composite.getContext("2d");

    let previousDisposal=0;
    let previousDims=null;
    let restoreCanvas=null;

    frames=[];
    frameDelays=[];

    for(const frame of raw){
      if(previousDisposal===2&&previousDims){
        cctx.clearRect(
          Math.round(previousDims.left*scale),
          Math.round(previousDims.top*scale),
          Math.max(1,Math.round(previousDims.width*scale)),
          Math.max(1,Math.round(previousDims.height*scale))
        );
      }else if(previousDisposal===3&&restoreCanvas){
        cctx.clearRect(0,0,w,h);
        cctx.drawImage(restoreCanvas,0,0);
      }

      let currentRestore=null;
      if(frame.disposalType===3){
        currentRestore=document.createElement("canvas");
        currentRestore.width=w;
        currentRestore.height=h;
        currentRestore.getContext("2d").drawImage(composite,0,0);
      }

      const patch=document.createElement("canvas");
      patch.width=frame.dims.width;
      patch.height=frame.dims.height;
      patch.getContext("2d").putImageData(
        new ImageData(frame.patch,frame.dims.width,frame.dims.height),
        0,0
      );

      cctx.drawImage(
        patch,
        Math.round(frame.dims.left*scale),
        Math.round(frame.dims.top*scale),
        Math.max(1,Math.round(frame.dims.width*scale)),
        Math.max(1,Math.round(frame.dims.height*scale))
      );

      const output=document.createElement("canvas");
      output.width=w;
      output.height=h;
      output.getContext("2d").drawImage(composite,0,0);
      applyPixels(output);

      frames.push(output);
      frameDelays.push(Math.max(20,Number(frame.delay)||100));

      previousDisposal=frame.disposalType||0;
      previousDims=frame.dims;
      restoreCanvas=currentRestore;
    }

    if(mode==="gif"){
      fileName.textContent=file.name+" · "+frames.length+" frames";
    }
  }catch(error){
    console.error("REMOVE DARK GIF decode:",error);
    frames=[];
    frameDelays=[];
  }
}

function loadFile(file){
  if(!file)return;
  const type=file.type||"";
  if(type==="image/gif"||/\.gif$/i.test(file.name||"")){
    loadGifPreview(file);
  }else if(type.startsWith("image/")){
    loadImage(file);
  }
}

function exportGif(){
  if(!frames.length){
    fileName.textContent=currentFile.name+" · preparando GIF…";
    decodeGifForDownload(currentFile);
    return;
  }

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

    frames.forEach((frame)=>{
      const out=document.createElement("canvas");
      out.width=frame.width;
      out.height=frame.height;
      const octx=out.getContext("2d");
      octx.fillStyle="#00ff00";
      octx.fillRect(0,0,out.width,out.height);
      octx.drawImage(frame,0,0);

      const data=octx.getImageData(0,0,out.width,out.height);
      for(let i=0;i<data.data.length;i+=4){
        if(data.data[i+3]<128){
          data.data[i]=0;
          data.data[i+1]=255;
          data.data[i+2]=0;
        }
        data.data[i+3]=255;
      }
      octx.putImageData(data,0,0);

      gif.addFrame(out,{delay:frameDelays[gif.frames.length]||100,copy:true});
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

fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));

dropZone.addEventListener("click",e=>{
  if(e.target!==fileInput)fileInput.click();
});

["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
  dropZone.classList.add("dragging");
}));

["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
  dropZone.classList.remove("dragging");
}));

dropZone.addEventListener("drop",e=>{
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});

threshold.addEventListener("input",()=>{
  updateThresholdLabel();
  if(mode==="image"){
    drawSourceImage();
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

  if(mode==="gif"){
    exportGif();
  }
});

reset.addEventListener("click",()=>{
  fileInput.value="";
  resetState();
});

updateThresholdLabel();
