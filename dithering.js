const fileInput=document.getElementById("fileInput");
const dropZone=document.getElementById("dropZone");
const canvas=document.getElementById("canvas");
const ctx=canvas.getContext("2d");
const size=document.getElementById("size");
const threshold=document.getElementById("threshold");
const method=document.getElementById("method");
const mode=document.getElementById("mode");
const colors=document.getElementById("colors");
const sizeValue=document.getElementById("sizeValue");
const thresholdValue=document.getElementById("thresholdValue");
const modeValue=document.getElementById("modeValue");
const colorsValue=document.getElementById("colorsValue");
const download=document.getElementById("download");
const reset=document.getElementById("reset");
const placeholder=document.getElementById("placeholder");
const fileName=document.getElementById("fileName");

let image=null;
let url=null;
let sourceCanvas=null;
let sourceCtx=null;
let sourceData=null;
let paletteCacheKey="";
let paletteCache=null;
let renderTimer=0;
let renderId=0;

const MAX_SIZE=1000;
const SAMPLE_LIMIT=9000;

const bayer4=[
  0,8,2,10,
  12,4,14,6,
  3,11,1,9,
  15,7,13,5
];

function luminance(r,g,b){
  return r*.2126+g*.7152+b*.0722;
}

function updateLabels(){
  sizeValue.textContent=Number(size.value)+" px";
  thresholdValue.textContent=Number(threshold.value)+"%";
  modeValue.textContent=mode.value==="bw"?"B/N":"COLOR";
  colorsValue.textContent=Number(colors.value);
}

function makeGrayPalette(count){
  const palette=[];
  if(count<=1)return [[0,0,0]];
  for(let i=0;i<count;i++){
    const v=Math.round(i*255/(count-1));
    palette.push([v,v,v]);
  }
  return palette;
}

function colorDistance(a,r,g,b){
  const dr=r-a[0],dg=g-a[1],db=b-a[2];
  return dr*dr+dg*dg+db*db;
}

function nearestPaletteIndex(r,g,b,palette){
  let best=0;
  let bestDistance=Infinity;
  for(let i=0;i<palette.length;i++){
    const d=colorDistance(palette[i],r,g,b);
    if(d<bestDistance){
      bestDistance=d;
      best=i;
    }
  }
  return best;
}

function buildColorPalette(data,w,h,count){
  const step=Math.max(1,Math.floor(Math.sqrt((w*h)/SAMPLE_LIMIT)));
  const samples=[];

  for(let y=0;y<h;y+=step){
    for(let x=0;x<w;x+=step){
      const i=(y*w+x)*4;
      samples.push([data[i],data[i+1],data[i+2]]);
    }
  }

  if(!samples.length)return [[0,0,0]];

  let boxes=[samples];

  while(boxes.length<count){
    let splitIndex=-1;
    let splitRange=-1;

    for(let i=0;i<boxes.length;i++){
      const box=boxes[i];
      if(box.length<2)continue;

      let minR=255,maxR=0,minG=255,maxG=0,minB=255,maxB=0;
      for(const p of box){
        if(p[0]<minR)minR=p[0];
        if(p[0]>maxR)maxR=p[0];
        if(p[1]<minG)minG=p[1];
        if(p[1]>maxG)maxG=p[1];
        if(p[2]<minB)minB=p[2];
        if(p[2]>maxB)maxB=p[2];
      }

      const range=Math.max(maxR-minR,maxG-minG,maxB-minB);
      const score=range*box.length;

      if(score>splitRange){
        splitRange=score;
        splitIndex=i;
      }
    }

    if(splitIndex<0)break;

    const box=boxes[splitIndex];
    let min=[255,255,255],max=[0,0,0];

    for(const p of box){
      for(let c=0;c<3;c++){
        if(p[c]<min[c])min[c]=p[c];
        if(p[c]>max[c])max[c]=p[c];
      }
    }

    let axis=0;
    if((max[1]-min[1])>(max[axis]-min[axis]))axis=1;
    if((max[2]-min[2])>(max[axis]-min[axis]))axis=2;

    box.sort((a,b)=>a[axis]-b[axis]);

    const middle=Math.floor(box.length/2);
    const left=box.slice(0,middle);
    const right=box.slice(middle);

    boxes.splice(splitIndex,1,left,right);
  }

  return boxes.map(box=>{
    let r=0,g=0,b=0;
    for(const p of box){
      r+=p[0];
      g+=p[1];
      b+=p[2];
    }
    return [
      Math.round(r/box.length),
      Math.round(g/box.length),
      Math.round(b/box.length)
    ];
  });
}

function getPalette(data,w,h,modeValue,colorCount){
  const key=modeValue+"|"+colorCount+"|"+w+"x"+h;

  if(key===paletteCacheKey&&paletteCache)return paletteCache;

  paletteCacheKey=key;
  paletteCache=modeValue==="bw"
    ? makeGrayPalette(colorCount)
    : buildColorPalette(data,w,h,colorCount);

  return paletteCache;
}

function makeLut(palette){
  const lut=new Uint8Array(32*32*32);

  for(let r=0;r<32;r++){
    for(let g=0;g<32;g++){
      for(let b=0;b<32;b++){
        const rr=r*255/31;
        const gg=g*255/31;
        const bb=b*255/31;
        lut[(r*32+g)*32+b]=nearestPaletteIndex(rr,gg,bb,palette);
      }
    }
  }

  return lut;
}

function lookupPaletteIndex(r,g,b,palette,lut){
  const rr=Math.max(0,Math.min(31,Math.round(r*31/255)));
  const gg=Math.max(0,Math.min(31,Math.round(g*31/255)));
  const bb=Math.max(0,Math.min(31,Math.round(b*31/255)));
  const index=lut[(rr*32+gg)*32+bb];

  // Refine around the LUT result so unusual palettes stay accurate.
  let best=index;
  let bestDistance=colorDistance(palette[index],r,g,b);

  const start=Math.max(0,index-2);
  const end=Math.min(palette.length,index+3);

  for(let i=start;i<end;i++){
    const d=colorDistance(palette[i],r,g,b);
    if(d<bestDistance){
      bestDistance=d;
      best=i;
    }
  }

  return best;
}

function processDither(data,w,h,cell,cut,methodValue,modeValue,colorCount){
  const palette=getPalette(data,w,h,modeValue,colorCount);
  const lut=makeLut(palette);

  const sw=Math.ceil(w/cell);
  const sh=Math.ceil(h/cell);
  const channels=modeValue==="bw"?1:3;
  const work=new Float32Array(sw*sh*channels);

  for(let by=0;by<sh;by++){
    for(let bx=0;bx<sw;bx++){
      let rr=0,gg=0,bb=0,count=0;

      for(let y=by*cell;y<Math.min((by+1)*cell,h);y++){
        for(let x=bx*cell;x<Math.min((bx+1)*cell,w);x++){
          const i=(y*w+x)*4;
          rr+=data[i];
          gg+=data[i+1];
          bb+=data[i+2];
          count++;
        }
      }

      const p=(by*sw+bx)*channels;

      if(modeValue==="bw"){
        const gray=(rr+gg+bb)/count/3;
        work[p]=gray;
      }else{
        work[p]=rr/count;
        work[p+1]=gg/count;
        work[p+2]=bb/count;
      }
    }
  }

  const out=new Uint8ClampedArray(data.length);

  if(methodValue==="bitmap"){
    for(let by=0;by<sh;by++){
      for(let bx=0;bx<sw;bx++){
        const p=(by*sw+bx)*channels;
        let index;

        if(modeValue==="bw"){
          const value=work[p];
          const binaryColorCount=colorCount===2;
          if(binaryColorCount){
            index=value>=cut?1:0;
          }else{
            index=Math.max(0,Math.min(colorCount-1,Math.round(value*(colorCount-1)/255)));
          }
        }else{
          index=lookupPaletteIndex(work[p],work[p+1],work[p+2],palette,lut);
        }

        const selected=palette[index];

        for(let y=by*cell;y<Math.min((by+1)*cell,h);y++){
          for(let x=bx*cell;x<Math.min((bx+1)*cell,w);x++){
            const i=(y*w+x)*4;
            out[i]=selected[0];
            out[i+1]=selected[1];
            out[i+2]=selected[2];
            out[i+3]=data[i+3];
          }
        }
      }
    }

    return out;
  }

  const kernels=methodValue==="atkinson"
    ? [[1,0,1/8],[2,0,1/8],[-1,1,1/8],[0,1,1/8],[1,1,1/8],[0,2,1/8]]
    : [[1,0,7/16],[-1,1,3/16],[0,1,5/16],[1,1,1/16]];

  for(let y=0;y<sh;y++){
    for(let x=0;x<sw;x++){
      const p=(y*sw+x)*channels;

      let paletteIndex;
      let errorR=0,errorG=0,errorB=0;

      if(modeValue==="bw"){
        const old=work[p];
        const index=colorCount===2
          ? (old>=cut?1:0)
          : Math.max(0,Math.min(colorCount-1,Math.round(old*(colorCount-1)/255)));

        const selected=palette[index];
        paletteIndex=index;
        errorR=old-selected[0];
        errorG=old-selected[1];
        errorB=old-selected[2];
        work[p]=selected[0];
      }else{
        const oldR=work[p];
        const oldG=work[p+1];
        const oldB=work[p+2];

        paletteIndex=lookupPaletteIndex(oldR,oldG,oldB,palette,lut);
        const selected=palette[paletteIndex];

        errorR=oldR-selected[0];
        errorG=oldG-selected[1];
        errorB=oldB-selected[2];

        work[p]=selected[0];
        work[p+1]=selected[1];
        work[p+2]=selected[2];
      }

      for(const [dx,dy,k] of kernels){
        const nx=x+dx;
        const ny=y+dy;
        if(nx<0||nx>=sw||ny<0||ny>=sh)continue;

        const np=(ny*sw+nx)*channels;

        if(modeValue==="bw"){
          work[np]+=errorR*k;
        }else{
          work[np]+=errorR*k;
          work[np+1]+=errorG*k;
          work[np+2]+=errorB*k;
        }
      }

      const selected=palette[paletteIndex];

      for(let py=y*cell;py<Math.min((y+1)*cell,h);py++){
        for(let px=x*cell;px<Math.min((x+1)*cell,w);px++){
          const i=(py*w+px)*4;
          out[i]=selected[0];
          out[i+1]=selected[1];
          out[i+2]=selected[2];
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
  const max=MAX_SIZE;
  const w=Math.min(image.naturalWidth,max);
  const h=Math.max(1,Math.round(image.naturalHeight*w/image.naturalWidth));

  canvas.width=w;
  canvas.height=h;

  ctx.drawImage(image,0,0,w,h);

  const src=ctx.getImageData(0,0,w,h);
  const cell=Number(size.value);
  const cut=Number(threshold.value)*2.55;
  const methodValue=method.value;
  const modeValue=mode.value;
  const colorCount=Number(colors.value);

  const out=processDither(src.data,w,h,cell,cut,methodValue,modeValue,colorCount);

  if(id!==renderId)return;

  ctx.putImageData(new ImageData(out,w,h),0,0);
  updateLabels();

  placeholder.hidden=true;
  canvas.hidden=false;
  download.disabled=false;
  reset.disabled=false;
}

function scheduleRender(){
  updateLabels();
  if(!image)return;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=setTimeout(()=>{
    renderTimer=0;
    render();
  },30);
}

function load(file){
  if(!file||!file.type.startsWith("image/"))return;

  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(file);

  const img=new Image();

  img.onload=()=>{
    image=img;
    paletteCacheKey="";
    paletteCache=null;
    fileName.textContent=file.name+" · Procesado en tu navegador.";
    render();
  };

  img.src=url;
}

fileInput.onchange=()=>load(fileInput.files[0]);
size.oninput=scheduleRender;
threshold.oninput=scheduleRender;
method.onchange=scheduleRender;
mode.onchange=scheduleRender;
colors.oninput=scheduleRender;

["dragenter","dragover"].forEach(name=>{
  dropZone.addEventListener(name,event=>{
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave","drop"].forEach(name=>{
  dropZone.addEventListener(name,event=>{
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.onclick=event=>{
  if(event.target!==fileInput)fileInput.click();
};

dropZone.ondrop=event=>{
  const file=event.dataTransfer.files&&event.dataTransfer.files[0];
  if(file)load(file);
};

download.onclick=()=>{
  const a=document.createElement("a");
  a.download="dithering.png";
  a.href=canvas.toDataURL("image/png");
  a.click();
};

reset.onclick=()=>{
  image=null;
  paletteCacheKey="";
  paletteCache=null;

  if(renderTimer)clearTimeout(renderTimer);
  renderTimer=0;

  fileInput.value="";
  canvas.hidden=true;
  placeholder.hidden=false;
  download.disabled=true;
  reset.disabled=true;

  size.value=4;
  threshold.value=50;
  method.value="bitmap";
  mode.value="bw";
  colors.value=2;

  updateLabels();
  fileName.textContent="Ninguna imagen seleccionada · Procesado en tu navegador.";
};

updateLabels();

window.NeoGif.register({
  fileInput,dropZone,download,reset,canvas,ctx,placeholder,fileName,maxSide:MAX_SIZE,
  renderFrame(frame){
    const previousImage=image;
    const previousPaletteKey=paletteCacheKey;
    const previousPalette=paletteCache;
    image=frame;
    frame.naturalWidth=frame.width;
    frame.naturalHeight=frame.height;
    paletteCacheKey="";
    paletteCache=null;
    render();
    const out=document.createElement("canvas");
    out.width=canvas.width;out.height=canvas.height;
    out.getContext("2d").drawImage(canvas,0,0);
    image=previousImage;
    paletteCacheKey=previousPaletteKey;
    paletteCache=previousPalette;
    return out;
  }
});
