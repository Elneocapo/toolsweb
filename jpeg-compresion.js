const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null,renderId=0,latestBlob=null;

function qualityFromCompression(value){
  // 0% = JPEG de máxima calidad.
  // 100% = JPEG extremadamente comprimido.
  const x=value/100;
  return Math.max(0.01,1-Math.pow(x,2.15)*0.99);
}

function encodeJpeg(source,quality){
  return new Promise(resolve=>{
    source.toBlob(blob=>resolve(blob),"image/jpeg",quality);
  });
}

function blobToCanvas(blob,width,height){
  return new Promise(resolve=>{
    const objectUrl=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      URL.revokeObjectURL(objectUrl);
      const out=document.createElement("canvas");
      out.width=width;
      out.height=height;
      const outCtx=out.getContext("2d");
      outCtx.drawImage(img,0,0,width,height);
      resolve(out);
    };
    img.src=objectUrl;
  });
}

async function render(){
  if(!image)return;

  const id=++renderId;
  const width=Math.min(image.naturalWidth,1600);
  const height=Math.max(1,Math.round(image.naturalHeight*width/image.naturalWidth));

  canvas.width=width;
  canvas.height=height;

  const value=Number(compression.value);
  compressionValue.textContent=value+"%";

  const source=document.createElement("canvas");
  source.width=width;
  source.height=height;
  source.getContext("2d").drawImage(image,0,0,width,height);

  // La vista previa se obtiene del JPEG codificado, no de un filtro.
  // En los niveles altos hacemos varias generaciones JPEG para que la
  // pérdida acumulada sea claramente visible.
  const quality=qualityFromCompression(value);
  let current=source;
  const generations=value===0?1:value<45?1:value<70?2:value<88?3:5;

  for(let i=0;i<generations;i++){
    if(id!==renderId)return;
    const generationQuality=Math.max(0.01,quality*(1-i*0.08));
    const blob=await encodeJpeg(current,generationQuality);
    if(!blob||id!==renderId)return;
    current=await blobToCanvas(blob,width,height);
  }

  if(id!==renderId)return;

  ctx.clearRect(0,0,width,height);
  ctx.drawImage(current,0,0,width,height);

  // Descargar exactamente la versión JPEG que se está previsualizando.
  latestBlob=await encodeJpeg(current,Math.max(0.01,quality));
  if(id!==renderId)return;

  placeholder.hidden=true;
  canvas.hidden=false;
  download.disabled=false;
  reset.disabled=false;
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;

  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(file);

  const img=new Image();
  img.onload=()=>{
    image=img;
    fileName.textContent=file.name+" · JPEG procesado en tu navegador.";
    render();
  };
  img.src=url;
}

fileInput.onchange=()=>load(fileInput.files[0]);
compression.oninput=render;

["dragenter","dragover"].forEach(eventName=>{
  dropZone.addEventListener(eventName,event=>{
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave","drop"].forEach(eventName=>{
  dropZone.addEventListener(eventName,event=>{
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.onclick=event=>{
  if(event.target!==fileInput)fileInput.click();
};

dropZone.ondrop=event=>load(event.dataTransfer.files[0]);

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
  renderId++;
  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  compression.value=0;
  compressionValue.textContent="0%";
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};