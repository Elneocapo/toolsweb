const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null,renderId=0,latestBlob=null;

const LUMA_Q=[16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];

function quantScale(v){
  // Much stronger curve: visible degradation starts near the beginning.
  if(v<=0)return 1;
  return 1+Math.pow(v/100,1.45)*18;
}

const clamp=v=>Math.max(0,Math.min(255,v));
const cos=Math.cos;
const C=new Float64Array(64);
const D=new Float64Array(64);

function processJPEG(data,w,h,v){
  const out=new Uint8ClampedArray(data);
  const scale=quantScale(v);

  for(let by=0;by<h;by+=8){
    for(let bx=0;bx<w;bx+=8){
      // Luminance only: this keeps skin/colours stable while creating
      // the characteristic JPEG block quantization.
      for(let y=0;y<8;y++){
        for(let x=0;x<8;x++){
          const sx=Math.min(w-1,bx+x),sy=Math.min(h-1,by+y),i=(sy*w+sx)*4;
          C[y*8+x]=.299*data[i]+.587*data[i+1]+.114*data[i+2]-128;
        }
      }

      for(let v2=0;v2<8;v2++)for(let u=0;u<8;u++){
        let sum=0;
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)
          sum+=C[y*8+x]*cos((2*x+1)*u*Math.PI/16)*cos((2*y+1)*v2*Math.PI/16);
        const au=u===0?.70710678:1,av=v2===0?.70710678:1;
        D[v2*8+u]=.25*au*av*sum;
      }

      for(let k=0;k<64;k++){
        const q=LUMA_Q[k]*scale;
        D[k]=Math.round(D[k]/q)*q;
      }

      for(let y=0;y<8&&by+y<h;y++){
        for(let x=0;x<8&&bx+x<w;x++){
          let sum=0;
          for(let v2=0;v2<8;v2++)for(let u=0;u<8;u++){
            const au=u===0?.70710678:1,av=v2===0?.70710678:1;
            sum+=au*av*D[v2*8+u]*cos((2*x+1)*u*Math.PI/16)*cos((2*y+1)*v2*Math.PI/16);
          }
          const lum=.25*sum+128;
          const i=((by+y)*w+(bx+x))*4;
          const originalLum=.299*data[i]+.587*data[i+1]+.114*data[i+2];
          const delta=lum-originalLum;
          // Apply only luminance delta. RGB chroma remains untouched.
          out[i]=clamp(data[i]+delta);
          out[i+1]=clamp(data[i+1]+delta);
          out[i+2]=clamp(data[i+2]+delta);
          out[i+3]=data[i+3];
        }
      }
    }
  }
  return out;
}

function render(){
  if(!image)return;
  const id=++renderId;
  const w=Math.min(image.naturalWidth,800);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));
  canvas.width=w;canvas.height=h;

  const source=document.createElement("canvas");
  source.width=w;source.height=h;
  const sc=source.getContext("2d");
  sc.drawImage(image,0,0,w,h);
  const src=sc.getImageData(0,0,w,h);

  const value=Number(compression.value);
  compressionValue.textContent=value+"%";

  // Yield between slider events so the browser never locks while dragging.
  requestAnimationFrame(()=>{
    if(id!==renderId)return;
    const processed=value===0?src.data:processJPEG(src.data,w,h,value);
    if(id!==renderId)return;
    ctx.putImageData(new ImageData(processed,w,h),0,0);
    canvas.hidden=false;
    placeholder.hidden=true;
    download.disabled=false;
    reset.disabled=false;

    canvas.toBlob(blob=>{
      if(id===renderId)latestBlob=blob;
    },"image/jpeg",Math.max(.05,1-value/110));
  });
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

["dragenter","dragover"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.onclick=e=>{if(e.target!==fileInput)fileInput.click()};
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
  compression.value=0;
  compressionValue.textContent="0%";
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};