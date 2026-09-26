const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");let image=null,url=null,renderId=0,latestBlob=null;

function jpegQualityFromCompression(c){
  // Mapea la compresión de forma no lineal: la mayor parte del rango
  // mantiene detalle y el extremo final entra en cuantización JPEG muy agresiva.
  const x=c/100;
  return Math.max(0.005,1-Math.pow(x,1.65)*0.995);
}

function render(){
  if(!image)return;
  const id=++renderId;
  const w=Math.min(image.naturalWidth,1600);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));

  canvas.width=w;
  canvas.height=h;

  const temp=document.createElement("canvas");
  temp.width=w;
  temp.height=h;
  const tc=temp.getContext("2d");
  tc.drawImage(image,0,0,w,h);

  const c=+compression.value;
  compressionValue.textContent=c+"%";
  const quality=jpegQualityFromCompression(c);

  // La imagen se vuelve a codificar realmente como JPEG.
  // No se altera la resolución, no se pixeliza artificialmente
  // y no se aplica ningún filtro de color.
  temp.toBlob(blob=>{
    if(!blob||id!==renderId)return;

    latestBlob=blob;
    const previewUrl=URL.createObjectURL(blob);
    const compressed=new Image();

    compressed.onload=()=>{
      if(id!==renderId){
        URL.revokeObjectURL(previewUrl);
        return;
      }

      ctx.clearRect(0,0,w,h);
      ctx.drawImage(compressed,0,0,w,h);
      URL.revokeObjectURL(previewUrl);

      placeholder.hidden=true;
      canvas.hidden=false;
      download.disabled=false;
      reset.disabled=false;
    };

    compressed.src=previewUrl;
  },"image/jpeg",quality);
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

["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
  dropZone.classList.add("dragging");
}));

["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{
  x.preventDefault();
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
  renderId++;
  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;
  compression.value=50;
  compressionValue.textContent="50%";
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};