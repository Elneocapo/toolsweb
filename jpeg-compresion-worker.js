const LUMA_Q=[
  16,11,10,16,24,40,51,61,
  12,12,14,19,26,58,60,55,
  14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62,
  18,22,37,56,68,109,103,77,
  24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,
  72,92,95,98,112,100,103,99
];

let width=0;
let height=0;
let original=null;
let luma=null;
let blockSize=8;
let cosTable=null;
let alpha=null;
let block=null;
let horizontal=null;
let coeff=null;
let vertical=null;

function buildTransform(size){
  blockSize=size;
  cosTable=new Float32Array(size*size);
  alpha=new Float32Array(size);

  const factor=Math.PI/(2*size);
  for(let i=0;i<size;i++){
    alpha[i]=i===0?Math.sqrt(1/size):Math.sqrt(2/size);
    for(let x=0;x<size;x++){
      cosTable[i*size+x]=Math.cos((2*x+1)*i*factor);
    }
  }

  const total=size*size;
  block=new Float32Array(total);
  horizontal=new Float32Array(total);
  coeff=new Float32Array(total);
  vertical=new Float32Array(total);
}

function clamp(v){
  return Math.max(0,Math.min(255,v));
}

function quantTableValue(u,v,n){
  const qu=Math.min(7,Math.floor(u*8/n));
  const qv=Math.min(7,Math.floor(v*8/n));
  return LUMA_Q[qv*8+qu]*(n/8);
}

function render(value,gain){
  const strength=value/100;
  const acGain=gain/100;
  const n=blockSize;

  // At 0% compression and neutral AC gain, return the source exactly.
  if(strength===0 && acGain===1){
    return new Uint8ClampedArray(original);
  }

  const out=new Uint8ClampedArray(original);
  const qScale=0.5+8*strength;

  for(let by=0;by<height;by+=n){
    for(let bx=0;bx<width;bx+=n){

      for(let y=0;y<n;y++){
        const sy=Math.min(height-1,by+y);
        for(let x=0;x<n;x++){
          const sx=Math.min(width-1,bx+x);
          block[y*n+x]=luma[sy*width+sx]-128;
        }
      }

      // Horizontal DCT.
      for(let y=0;y<n;y++){
        for(let u=0;u<n;u++){
          let sum=0;
          const cBase=u*n;
          for(let x=0;x<n;x++){
            sum+=block[y*n+x]*cosTable[cBase+x];
          }
          horizontal[y*n+u]=sum*alpha[u];
        }
      }

      // Vertical DCT.
      for(let v=0;v<n;v++){
        const cBase=v*n;
        for(let u=0;u<n;u++){
          let sum=0;
          for(let y=0;y<n;y++){
            sum+=horizontal[y*n+u]*cosTable[cBase+y];
          }

          let value2=sum*alpha[v];

          // DC stores the block's average. AC stores spatial detail.
          // Compression quantizes AC; AC gain scales those detail terms.
          if(v!==0 || u!==0){
            const q=Math.max(1,quantTableValue(u,v,n)*qScale);
            value2=Math.round(value2/q)*q;
            value2*=acGain;
          }

          coeff[v*n+u]=value2;
        }
      }

      // Inverse vertical DCT.
      for(let y=0;y<n;y++){
        for(let u=0;u<n;u++){
          let sum=0;
          for(let v=0;v<n;v++){
            sum+=alpha[v]*coeff[v*n+u]*cosTable[v*n+y];
          }
          vertical[y*n+u]=sum;
        }
      }

      // Inverse horizontal DCT and write only the luma difference.
      for(let y=0;y<n;y++){
        const py=by+y;
        if(py>=height)continue;

        for(let x=0;x<n;x++){
          const px=bx+x;
          if(px>=width)continue;

          let sum=0;
          for(let u=0;u<n;u++){
            sum+=alpha[u]*vertical[y*n+u]*cosTable[u*n+x];
          }

          const processedLuma=sum+128;
          const p=(py*width+px)*4;
          const delta=processedLuma-luma[py*width+px];

          out[p]=clamp(original[p]+delta);
          out[p+1]=clamp(original[p+1]+delta);
          out[p+2]=clamp(original[p+2]+delta);
          out[p+3]=original[p+3];
        }
      }
    }
  }

  return out;
}

self.onmessage=event=>{
  const data=event.data;

  try{
    if(data.type==="init"){
      width=data.width;
      height=data.height;
      original=new Uint8ClampedArray(data.buffer);
      luma=new Float32Array(width*height);

      for(let i=0,p=0;i<original.length;i+=4,p++){
        luma[p]=0.299*original[i]+0.587*original[i+1]+0.114*original[i+2];
      }

      buildTransform(data.blockSize||8);
      self.postMessage({type:"ready"});
      return;
    }

    if(data.type==="render"){
      if(data.blockSize!==blockSize){
        buildTransform(data.blockSize);
      }

      const out=render(data.compression,data.acGain);
      self.postMessage({
        type:"result",
        token:data.token,
        buffer:out.buffer
      },[out.buffer]);
    }
  }catch(error){
    self.postMessage({
      type:"error",
      token:data&&data.token,
      message:error&&error.message?error.message:"No se pudo procesar la imagen."
    });
  }
};
