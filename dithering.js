const fileInput=document.getElementById("fileInput"),dropZone=document.getElementById("dropZone"),canvas=document.getElementById("canvas"),ctx=canvas.getContext("2d"),size=document.getElementById("size"),threshold=document.getElementById("threshold"),method=document.getElementById("method"),sizeValue=document.getElementById("sizeValue"),thresholdValue=document.getElementById("thresholdValue"),download=document.getElementById("download"),reset=document.getElementById("reset"),placeholder=document.getElementById("placeholder"),fileName=document.getElementById("fileName");
let image=null,url=null;
function luminance(r,g,b){return r*.2126+g*.7152+b*.0722}
function processBitmap(data,w,h,cell,cut){
  const out=new Uint8ClampedArray(data.length);
  for(let by=0;by<h;by+=cell)for(let bx=0;bx<w;bx+=cell){
    let sum=0,count=0;
    for(let y=by;y<Math.min(by+cell,h);y++)for(let x=bx;x<Math.min(bx+cell,w);x++){const i=(y*w+x)*4;sum+=luminance(data[i],data[i+1],data[i+2]);count++}
    const v=sum/count>=cut?255:0;
    for(let y=by;y<Math.min(by+cell,h);y++)for(let x=bx;x<Math.min(bx+cell,w);x++){const i=(y*w+x)*4;out[i]=out[i+1]=out[i+2]=v;out[i+3]=data[i+3]}
  }
  return out;
}
function processError(data,w,h,cell,cut,type){
  const sw=Math.ceil(w/cell),sh=Math.ceil(h/cell),gray=new Float32Array(sw*sh);
  for(let by=0;by<sh;by++)for(let bx=0;bx<sw;bx++){
    let sum=0,count=0;
    for(let y=by*cell;y<Math.min((by+1)*cell,h);y++)for(let x=bx*cell;x<Math.min((bx+1)*cell,w);x++){const i=(y*w+x)*4;sum+=luminance(data[i],data[i+1],data[i+2]);count++}
    gray[by*sw+bx]=sum/count;
  }
  const out=new Uint8ClampedArray(data.length),kernels=type==="atkinson"?[[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]]:[[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
    const p=y*sw+x,old=gray[p],v=old>=cut?255:0,err=old-v;gray[p]=v;
    for(const [dx,dy,k] of kernels){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<sw&&ny>=0&&ny<sh)gray[ny*sw+nx]+=err*k}
  }
  for(let by=0;by<sh;by++)for(let bx=0;bx<sw;bx++){const v=gray[by*sw+bx]>=128?255:0;for(let y=by*cell;y<Math.min((by+1)*cell,h);y++)for(let x=bx*cell;x<Math.min((bx+1)*cell,w);x++){const i=(y*w+x)*4;out[i]=out[i+1]=out[i+2]=v;out[i+3]=data[i+3]}}
  return out;
}
function render(){
 if(!image)return;
 const max=1400,w=Math.min(image.naturalWidth,max),h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));
 canvas.width=w;canvas.height=h;ctx.drawImage(image,0,0,w,h);
 const src=ctx.getImageData(0,0,w,h),cut=+threshold.value*2.55,cell=+size.value;
 let out;
 if(method.value==="bitmap")out=processBitmap(src.data,w,h,cell,cut);
 else if(method.value==="floyd"||method.value==="atkinson")out=processError(src.data,w,h,cell,cut,method.value);

 ctx.putImageData(new ImageData(out,w,h),0,0);
 sizeValue.textContent=cell+" px";thresholdValue.textContent=threshold.value+"%";placeholder.hidden=true;canvas.hidden=false;download.disabled=false;reset.disabled=false;
}
function load(file){if(!file||!file.type.startsWith("image/"))return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{image=img;fileName.textContent=file.name+" · Procesado en tu navegador.";render()};img.src=url}
fileInput.onchange=()=>load(fileInput.files[0]);size.oninput=render;threshold.oninput=render;method.onchange=render;
["dragenter","dragover"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.add("dragging")}));
["dragleave","drop"].forEach(e=>dropZone.addEventListener(e,x=>{x.preventDefault();dropZone.classList.remove("dragging")}));
dropZone.onclick=e=>{if(e.target!==fileInput)fileInput.click()};dropZone.ondrop=e=>load(e.dataTransfer.files[0]);
download.onclick=()=>{const a=document.createElement("a");a.download="dithering.png";a.href=canvas.toDataURL("image/png");a.click()};
reset.onclick=()=>{image=null;fileInput.value="";canvas.hidden=true;placeholder.hidden=false;download.disabled=true;reset.disabled=true;fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador."};