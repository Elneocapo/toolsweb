const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null,renderId=0,latestBlob=null;

function jpegQuality(c){
  const x=c/100;
  // Calidad invertida y muy agresiva al final del recorrido.
  // 0% = prácticamente sin pérdida; 100% = cuantización JPEG extrema.
  return Math.max(.008,Math.pow(1-x,2.35));
}

function jpegPass(source,quality){
  return new Promise(resolve=>{
    source.toBlob(blob=>{
      if(!blob){resolve(null);return}
      const objectUrl=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(objectUrl);
        const out=document.createElement("canvas");
        out.width=source.width;
        out.height=source.height;
        out.getContext("2d").drawImage(img,0,0,out.width,out.height);
        resolve(out);
      };
      img.src=objectUrl;
    },"image/jpeg",quality);
  });
}

async function render(){
  if(!image)return;
  const id=++renderId;
  const w=Math.min(image.naturalWidth,1600);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));
  canvas.width=w;
  canvas.height=h;

  const c=+compression.value;
  compressionValue.textContent=c+"%";

  const base=document.createElement("canvas");
  base.width=w;
  base.height=h;
  base.getContext("2d").drawImage(image,0,0,w,h);

  const quality=jpegQuality(c);

  // Re-codificamos el JPEG varias veces en los niveles altos.
  // Sigue siendo compresión JPEG real: cada pasada usa el encoder JPEG
  // del navegador y vuelve a decodificar el resultado antes de la siguiente.
  const passes=c<35?1:c<65?2:c<82?3:4;
  let current=base;

  for(let i=0;i<passes;i++){
    if(id!==renderId)return;
    const passQuality=Math.max(.008,quality*(1-(i*.12)));
    current=await jpegPass(current,passQuality);
    if(!current||id!==renderId)return;
  }

  if(id!==renderId)return;

  ctx.clearRect(0,0,w,h);
  ctx.drawImage(current,0,0,w,h);

  // El blob descargable es exactamente la última codificación JPEG.
  latestBlob=await new Promise(resolve=>current.toBlob(resolve,"image/jpeg",quality));
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