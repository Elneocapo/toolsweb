const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");

let image=null,url=null,sourceCanvas=null,sourceCtx=null,sourceData=null,worker=null,workerUrl=null,renderToken=0,renderTimer=0,latestBlob=null,workerReady=false;

const MAX_SIDE=800;

function qualityFromCompression(value){
  if(value<=0)return 1;
  // Inverted JPEG quality curve: small slider movements already introduce
  // visible DCT quantization, while the top end becomes heavily degraded.
  return Math.max(0.04,1-Math.pow(value/100,0.62)*0.95);
}

function clamp(v){
  return Math.max(0,Math.min(255,v));
}

function applyLumaCompression(original,compressed){
  const out=new Uint8ClampedArray(original);
  for(let i=0;i<original.length;i+=4){
    const originalLum=.299*original[i]+.587*original[i+1]+.114*original[i+2];
    const jpegLum=.299*compressed[i]+.587*compressed[i+1]+.114*compressed[i+2];
    const delta=jpegLum-originalLum;
    out[i]=clamp(original[i]+delta);
    out[i+1]=clamp(original[i+1]+delta);
    out[i+2]=clamp(original[i+2]+delta);
    out[i+3]=original[i+3];
  }
  return out;
}

function makeWorker(){
  if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)return null;

  const code=\`
let original=null,w=0,h=0,grayCanvas=null,grayCtx=null,decodeCanvas=null,decodeCtx=null;

const clamp=v=>Math.max(0,Math.min(255,v));

function qualityFromCompression(value){
  if(value<=0)return 1;
  return Math.max(0.04,1-Math.pow(value/100,0.62)*0.95);
}

function applyLumaCompression(original,compressed){
  const out=new Uint8ClampedArray(original);
  for(let i=0;i<original.length;i+=4){
    const originalLum=.299*original[i]+.587*original[i+1]+.114*original[i+2];
    const jpegLum=.299*compressed[i]+.587*compressed[i+1]+.114*compressed[i+2];
    const delta=jpegLum-originalLum;
    out[i]=clamp(original[i]+delta);
    out[i+1]=clamp(original[i+1]+delta);
    out[i+2]=clamp(original[i+2]+delta);
    out[i+3]=original[i+3];
  }
  return out;
}

self.onmessage=async event=>{
  const data=event.data;
  try{
    if(data.type==="init"){
      w=data.width;
      h=data.height;
      original=new Uint8ClampedArray(data.buffer);

      grayCanvas=new OffscreenCanvas(w,h);
      grayCtx=grayCanvas.getContext("2d",{willReadFrequently:true});

      const gray=new Uint8ClampedArray(original.length);
      for(let i=0;i<original.length;i+=4){
        const lum=Math.round(.299*original[i]+.587*original[i+1]+.114*original[i+2]);
        gray[i]=lum;
        gray[i+1]=lum;
        gray[i+2]=lum;
        gray[i+3]=original[i+3];
      }
      grayCtx.putImageData(new ImageData(gray,w,h),0,0);

      decodeCanvas=new OffscreenCanvas(w,h);
      decodeCtx=decodeCanvas.getContext("2d",{willReadFrequently:true});

      self.postMessage({type:"ready"});
      return;
    }

    if(data.type==="render"){
      const token=data.token;
      const quality=qualityFromCompression(data.value);

      const jpegBlob=await grayCanvas.convertToBlob({
        type:"image/jpeg",
        quality
      });

      const bitmap=await createImageBitmap(jpegBlob);

      decodeCtx.clearRect(0,0,w,h);
      decodeCtx.drawImage(bitmap,0,0,w,h);
      bitmap.close();

      const compressed=decodeCtx.getImageData(0,0,w,h).data;
      const out=applyLumaCompression(original,compressed);

      self.postMessage({type:"result",token,buffer:out.buffer},[out.buffer]);
    }
  }catch(error){
    self.postMessage({
      type:"error",
      token:data&&data.token,
      message:error&&error.message?error.message:"No se pudo procesar la imagen."
    });
  }
};
\`;

  const blob=new Blob([code],{type:"application/javascript"});
  workerUrl=URL.createObjectURL(blob);
  const w=new Worker(workerUrl);

  w.onmessage=event=>{
    const data=event.data;

    if(data.type==="ready"){
      workerReady=true;
      requestRender();
      return;
    }

    if(data.type==="result"){
      if(data.token!==renderToken)return;
      const result=new Uint8ClampedArray(data.buffer);
      ctx.putImageData(new ImageData(result,canvas.width,canvas.height),0,0);
      canvas.hidden=false;
      placeholder.hidden=true;
      download.disabled=false;
      reset.disabled=false;

      canvas.toBlob(blob=>{
        if(data.token===renderToken)latestBlob=blob;
      },"image/jpeg",0.98);
      return;
    }

    if(data.type==="error"){
      console.error("JPEG worker:",data.message);
      fallbackRender(data.token);
    }
  };

  w.onerror=()=>{
    workerReady=false;
    fallbackRender(renderToken);
  };

  w.postMessage({
    type:"init",
    width:canvas.width,
    height:canvas.height,
    buffer:sourceData.buffer
  },[sourceData.buffer]);

  sourceData=null;
  return w;
}

async function fallbackRender(token){
  if(!sourceCanvas||!sourceCtx||token!==renderToken)return;

  const value=Number(compression.value);

  if(value===0){
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sourceCtx.getImageData(0,0,canvas.width,canvas.height).data),canvas.width,canvas.height),0,0);
    canvas.hidden=false;
    placeholder.hidden=true;
    download.disabled=false;
    reset.disabled=false;
    canvas.toBlob(blob=>{
      if(token===renderToken)latestBlob=blob;
    },"image/jpeg",0.98);
    return;
  }

  try{
    const original=sourceCtx.getImageData(0,0,canvas.width,canvas.height).data;
    const temp=document.createElement("canvas");
    temp.width=canvas.width;
    temp.height=canvas.height;
    const tctx=temp.getContext("2d",{willReadFrequently:true});

    const gray=new Uint8ClampedArray(original.length);
    for(let i=0;i<original.length;i+=4){
      const lum=Math.round(.299*original[i]+.587*original[i+1]+.114*original[i+2]);
      gray[i]=lum;
      gray[i+1]=lum;
      gray[i+2]=lum;
      gray[i+3]=original[i+3];
    }

    tctx.putImageData(new ImageData(gray,canvas.width,canvas.height),0,0);

    const quality=qualityFromCompression(value);

    tctx.canvas.toBlob(async blob=>{
      if(token!==renderToken)return;
      const bitmap=await createImageBitmap(blob);
      if(token!==renderToken){
        bitmap.close();
        return;
      }

      const decoded=document.createElement("canvas");
      decoded.width=canvas.width;
      decoded.height=canvas.height;
      const dctx=decoded.getContext("2d",{willReadFrequently:true});
      dctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close();

      const processed=applyLumaCompression(original,dctx.getImageData(0,0,canvas.width,canvas.height).data);
      if(token!==renderToken)return;

      ctx.putImageData(new ImageData(processed,canvas.width,canvas.height),0,0);
      canvas.hidden=false;
      placeholder.hidden=true;
      download.disabled=false;
      reset.disabled=false;
      canvas.toBlob(outBlob=>{
        if(token===renderToken)latestBlob=outBlob;
      },"image/jpeg",0.98);
    },"image/jpeg",quality);
  }catch(error){
    console.error("JPEG fallback:",error);
  }
}

function render(){
  if(!image)return;

  compressionValue.textContent=Number(compression.value)+"%";
  renderToken++;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    renderTimer=0;
    requestRender();
  },40);
}

function requestRender(){
  if(!image)return;

  const token=renderToken;
  const value=Number(compression.value);

  if(value===0){
    if(sourceData){
      const copy=new Uint8ClampedArray(sourceData);
      ctx.putImageData(new ImageData(copy,canvas.width,canvas.height),0,0);
    }else if(sourceCtx){
      ctx.drawImage(sourceCanvas,0,0);
    }
    canvas.hidden=false;
    placeholder.hidden=true;
    download.disabled=false;
    reset.disabled=false;
    canvas.toBlob(blob=>{
      if(token===renderToken)latestBlob=blob;
    },"image/jpeg",0.98);
    return;
  }

  if(worker&&workerReady){
    worker.postMessage({type:"render",token,value});
  }else{
    fallbackRender(token);
  }
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;

  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(file);

  const img=new Image();
  img.onload=()=>{
    image=img;

    const scale=Math.min(1,MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale));
    const h=Math.max(1,Math.round(img.naturalHeight*scale));

    canvas.width=w;
    canvas.height=h;

    sourceCanvas=document.createElement("canvas");
    sourceCanvas.width=w;
    sourceCanvas.height=h;
    sourceCtx=sourceCanvas.getContext("2d",{willReadFrequently:true});
    sourceCtx.drawImage(img,0,0,w,h);

    sourceData=sourceCtx.getImageData(0,0,w,h).data;
    latestBlob=null;
    renderToken=0;
    compression.value=0;
    compressionValue.textContent="0%";
    fileName.textContent=file.name+" · JPEG procesado en tu navegador.";

    if(worker){
      worker.terminate();
      worker=null;
    }
    if(workerUrl){
      URL.revokeObjectURL(workerUrl);
      workerUrl=null;
    }

    workerReady=false;
    worker=makeWorker();

    if(!worker){
      requestRender();
    }
  };

  img.src=url;
}

fileInput.onchange=()=>load(fileInput.files[0]);
compression.oninput=render;

["dragenter","dragover"].forEach(n=>dropZone.addEventListener(n,e=>{
  e.preventDefault();
  dropZone.classList.add("dragging");
}));

["dragleave","drop"].forEach(n=>dropZone.addEventListener(n,e=>{
  e.preventDefault();
  dropZone.classList.remove("dragging");
}));

dropZone.onclick=e=>{
  if(e.target!==fileInput)fileInput.click();
};

dropZone.ondrop=e=>load(e.dataTransfer.files[0]);

download.onclick=()=>{
  if(!latestBlob)return;

  const a=document.createElement("a");
  a.download="jpeg-compresion.jpg";
  a.href=URL.createObjectURL(latestBlob);
  a.click();

  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};

reset.onclick=()=>{
  image=null;
  latestBlob=null;
  renderToken++;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=0;

  if(worker){
    worker.terminate();
    worker=null;
  }

  if(workerUrl){
    URL.revokeObjectURL(workerUrl);
    workerUrl=null;
  }

  if(url){
    URL.revokeObjectURL(url);
    url=null;
  }

  sourceCanvas=null;
  sourceCtx=null;
  sourceData=null;
  workerReady=false;

  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  compression.value=0;
  compressionValue.textContent="0%";
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};
