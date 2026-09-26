const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),compression=document.getElementById("compression"),compressionValue=document.getElementById("compressionValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null,renderId=0,latestBlob=null;

const LUMA_Q=[16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
const CHROMA_Q=[17,18,24,47,99,99,99,99,18,21,26,66,99,99,99,99,24,26,56,99,99,99,99,99,47,66,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,99];

function qualityToScale(v){
  // 0% = calidad JPEG 100. La curva entra fuerte desde el principio.
  if(v===0)return 1;
  const quality=100-v*0.94;
  return quality<50?5000/quality:200-quality*2;
}

function clamp(v){return Math.max(0,Math.min(255,v))}
function dctBlock(src,w,x0,y0,channel,qtable,scale){
  const c=new Float64Array(64);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const sx=Math.min(w-1,x0+x),sy=Math.min(Math.floor(src.length/(w*4))-1,y0+y);
    const i=(sy*w+sx)*4;
    let r=src[i],g=src[i+1],b=src[i+2];
    let value=channel===0?.299*r+.587*g+.114*b:channel===1?-.168736*r-.331264*g+.5*b+128:-.5*r-.418688*g+.081312*b+128;
    c[y*8+x]=value-128;
  }
  const out=new Float64Array(64);
  for(let v=0;v<8;v++)for(let u=0;u<8;u++){
    let sum=0;
    for(let y=0;y<8;y++)for(let x=0;x<8;x++)sum+=c[y*8+x]*Math.cos(((2*x+1)*u*Math.PI)/16)*Math.cos(((2*y+1)*v*Math.PI)/16);
    const au=u===0?1/Math.sqrt(2):1,av=v===0?1/Math.sqrt(2):1;
    out[v*8+u]=.25*au*av*sum;
  }
  for(let i=0;i<64;i++)out[i]=Math.round(out[i]/Math.max(1,qtable[i]*scale))*Math.max(1,qtable[i]*scale);
  return out;
}

function idctBlock(coeff,channel,qtable,scale){
  const out=new Float64Array(64);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    let sum=0;
    for(let v=0;v<8;v++)for(let u=0;u<8;u++){
      const au=u===0?1/Math.sqrt(2):1,av=v===0?1/Math.sqrt(2):1;
      sum+=au*av*coeff[v*8+u]*Math.cos(((2*x+1)*u*Math.PI)/16)*Math.cos(((2*y+1)*v*Math.PI)/16);
    }
    const value=.25*sum+128;
    out[y*8+x]=value;
  }
  return out;
}

function jpegLikeProcess(data,w,h,compressionValue){
  // Simula directamente la parte visual característica de JPEG:
  // bloques 8x8 + DCT + cuantización. Conservamos el color RGB sin
  // hacer reducción artificial de resolución ni posterización.
  const out=new Uint8ClampedArray(data);
  const scale=qualityToScale(compressionValue);
  for(let by=0;by<h;by+=8)for(let bx=0;bx<w;bx+=8){
    const Y=dctBlock(data,w,bx,by,0,LUMA_Q,scale);
    const Cb=dctBlock(data,w,bx,by,1,CHROMA_Q,scale);
    const Cr=dctBlock(data,w,bx,by,2,CHROMA_Q,scale);
    const yv=idctBlock(Y,0,LUMA_Q,scale),cb=idctBlock(Cb,1,CHROMA_Q,scale),cr=idctBlock(Cr,2,CHROMA_Q,scale);
    for(let y=0;y<8&&by+y<h;y++)for(let x=0;x<8&&bx+x<w;x++){
      const p=y*8+x,i=((by+y)*w+(bx+x))*4;
      const yy=yv[p],u=cb[p]-128,v=cr[p]-128;
      out[i]=clamp(yy+1.402*v);
      out[i+1]=clamp(yy-.344136*u-.714136*v);
      out[i+2]=clamp(yy+1.772*u);
    }
  }
  return out;
}

function render(){
  if(!image)return;
  const id=++renderId;
  const w=Math.min(image.naturalWidth,1200);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));
  canvas.width=w;canvas.height=h;
  const source=document.createElement("canvas");
  source.width=w;source.height=h;
  const sc=source.getContext("2d");
  sc.drawImage(image,0,0,w,h);
  const src=sc.getImageData(0,0,w,h);
  const value=Number(compression.value);
  compressionValue.textContent=value+"%";

  // 0% conserva exactamente la imagen. A partir de 1% la cuantización
  // empieza a actuar suavemente y aumenta de forma continua.
  const processed=value===0?src.data:jpegLikeProcess(src.data,w,h,value);
  if(id!==renderId)return;

  ctx.putImageData(new ImageData(processed,w,h),0,0);
  canvas.hidden=false;placeholder.hidden=true;download.disabled=false;reset.disabled=false;

  // Exportación JPEG real usando la imagen ya degradada por bloques.
  canvas.toBlob(blob=>{if(id===renderId)latestBlob=blob},"image/jpeg",Math.max(.05,1-value/105));
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;
  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{image=img;fileName.textContent=file.name+" · JPEG procesado en tu navegador.";render()};
  img.src=url;
}
fileInput.onchange=()=>load(fileInput.files[0]);
compression.oninput=render;
["dragenter","dragover"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.onclick=e=>{if(e.target!==fileInput)fileInput.click()};
dropZone.ondrop=e=>load(e.dataTransfer.files[0]);
download.onclick=()=>{if(!latestBlob)return;const a=document.createElement("a");a.download="jpeg-compresion.jpg";a.href=URL.createObjectURL(latestBlob);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
reset.onclick=()=>{image=null;latestBlob=null;renderId++;fileInput.value="";canvas.hidden=true;placeholder.hidden=false;download.disabled=true;reset.disabled=true;compression.value=0;compressionValue.textContent="0%";fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador."};