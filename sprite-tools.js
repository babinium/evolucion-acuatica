// Pixel processing runs once on loading an asset, never in the game loop.
const SpriteTools = (() => {
  const distance2 = (a,b) => (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;

  function borderColor(data,width,height) {
    const samples=[];
    const sample=(x,y)=>{const i=(y*width+x)*4;samples.push([...data.subarray(i,i+4)]);};
    for(let x=0;x<width;x+=Math.max(1,Math.floor(width/48))) {sample(x,0);sample(x,height-1);}
    for(let y=0;y<height;y+=Math.max(1,Math.floor(height/48))) {sample(0,y);sample(width-1,y);}
    if(samples.filter(p=>p[3]<16).length>samples.length*0.8) return null;
    const opaque=samples.filter(p=>p[3]>=240),groups=new Map();
    for(const p of opaque) {
      const key=p.slice(0,3).map(v=>v>>5).join(',');
      const group=groups.get(key)||[];group.push(p);groups.set(key,group);
    }
    const group=[...groups.values()].sort((a,b)=>b.length-a.length)[0];
    if(!group) throw new Error("No se pudo reconocer el fondo de la imagen.");
    const color=[0,1,2].map(k=>Math.round(group.reduce((s,p)=>s+p[k],0)/group.length));
    if(samples.filter(p=>p[3]<16||distance2(p,color)<48**2).length<samples.length*0.8) {
      throw new Error("La imagen no tiene un fondo uniforme recortable. Se conserva el dibujo local.");
    }
    return color;
  }

  function removeBackground(data,width,height,bg) {
    const count=width*height,mask=new Uint8Array(count),queue=new Int32Array(count);
    let length=0;
    const push=p=>{
      if(mask[p]) return;
      const i=p*4;
      if(data[i+3]>=16&&(data[i]-bg[0])**2+(data[i+1]-bg[1])**2+(data[i+2]-bg[2])**2>38**2) return;
      mask[p]=1;queue[length++]=p;
    };
    for(let x=0;x<width;x++) {push(x);push((height-1)*width+x);}
    for(let y=0;y<height;y++) {push(y*width);push(y*width+width-1);}
    for(let head=0;head<length;head++) {
      const p=queue[head],x=p%width,y=Math.floor(p/width);
      if(x>0) push(p-1);if(x+1<width) push(p+1);
      if(y>0) push(p-width);if(y+1<height) push(p+width);
    }
    const source=data.slice();
    for(let p=0;p<count;p++) {
      if(mask[p]) {data[p*4+3]=0;continue;}
      const x=p%width,y=Math.floor(p/width),i=p*4;
      if(!((x>0&&mask[p-1])||(x+1<width&&mask[p+1])||(y>0&&mask[p-width])||(y+1<height&&mask[p+width]))) continue;
      // Unmix only edge colors that lie between the matte and nearby body.
      let fg=null,furthest=0;
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
        if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height) continue;
        const q=(y+dy)*width+x+dx,j=q*4;
        if(mask[q]||source[j+3]<240) continue;
        const color=source.subarray(j,j+3),d=distance2(color,bg);
        if(d>furthest) {furthest=d;fg=color;}
      }
      if(!fg||furthest<80**2) continue;
      const direction=[0,1,2].map(k=>fg[k]-bg[k]);
      const coverage=Math.max(0,Math.min(1,direction.reduce((s,v,k)=>s+(source[i+k]-bg[k])*v,0)/furthest));
      const residual=[0,1,2].reduce((s,k)=>s+(source[i+k]-bg[k]-coverage*direction[k])**2,0);
      if(coverage>=0.98||residual>16**2) continue;
      data[i+3]=Math.round(source[i+3]*coverage);
      if(coverage>0.03) for(let k=0;k<3;k++) data[i+k]=Math.max(0,Math.min(255,Math.round((source[i+k]-(1-coverage)*bg[k])/coverage)));
    }
  }

  function removeSpecks(data,width,height) {
    const seen=new Uint8Array(width*height),queue=new Int32Array(width*height),components=[];
    for(let p=0;p<width*height;p++) {
      if(seen[p]||data[p*4+3]<16) continue;
      let length=1;queue[0]=p;seen[p]=1;
      for(let head=0;head<length;head++) {
        const q=queue[head],x=q%width,y=Math.floor(q/width);
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          const nx=x+dx,ny=y+dy,n=ny*width+nx;
          if(nx<0||nx>=width||ny<0||ny>=height||seen[n]||data[n*4+3]<16) continue;
          seen[n]=1;queue[length++]=n;
        }
      }
      components.push(queue.slice(0,length));
    }
    const largest=Math.max(0,...components.map(c=>c.length));
    for(const component of components) if(component.length<Math.max(3,largest*0.008)) {
      for(const p of component) data[p*4+3]=0;
    }
  }

  function isolateAnimal(data,width,height) {
    const count=width*height,distance=new Uint16Array(count),labels=new Uint8Array(count),queue=new Int32Array(count);
    const coreDepth=Math.max(2,Math.round(Math.min(width,height)/128))+1;
    // Two distance passes find solid interiors. A one-pixel stem must not make
    // unrelated scenery part of an animal, while sturdy fins remain attached.
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const p=y*width+x;
      if(data[p*4+3]>=16) distance[p]=1+Math.min(x?distance[p-1]:0,y?distance[p-width]:0);
    }
    for(let y=height-1;y>=0;y--) for(let x=width-1;x>=0;x--) {
      const p=y*width+x;
      if(distance[p]) distance[p]=Math.min(distance[p],1+Math.min(x+1<width?distance[p+1]:0,y+1<height?distance[p+width]:0));
    }
    const cores=[];
    for(let p=0;p<count;p++) {
      if(distance[p]<coreDepth||labels[p]) continue;
      let length=1;queue[0]=p;labels[p]=1;
      const color=[0,0,0];
      for(let head=0;head<length;head++) {
        const q=queue[head],x=q%width,y=Math.floor(q/width);
        for(let k=0;k<3;k++) color[k]+=data[q*4+k];
        for(const n of [x?q-1:-1,x+1<width?q+1:-1,y?q-width:-1,y+1<height?q+width:-1]) {
          if(n<0||labels[n]||distance[n]<coreDepth) continue;
          labels[n]=1;queue[length++]=n;
        }
      }
      cores.push({pixels:queue.slice(0,length),color:color.map(v=>v/length)});
    }
    cores.sort((a,b)=>b.pixels.length-a.pixels.length);
    if(cores.length<2) return;
    const primary=cores[0];
    const colors=new Map();
    for(const p of primary.pixels) {
      const rgb=data.subarray(p*4,p*4+3),key=[...rgb].map(v=>v>>6).join(',');
      const group=colors.get(key)||{count:0,sum:[0,0,0]};
      group.count++;for(let k=0;k<3;k++) group.sum[k]+=rgb[k];colors.set(key,group);
    }
    const palette=[...colors.values()].filter(group=>group.count>=primary.pixels.length*0.08).map(group=>group.sum.map(v=>v/group.count));
    if(!palette.length) palette.push(primary.color);
    const matchesBody=core=>palette.some(color=>distance2(core.color,color)<=60**2);
    const discarded=new Set(cores.filter(core=>core!==primary&&core.pixels.length>=Math.max(20,primary.pixels.length*0.08)&&!matchesBody(core)));
    if(!discarded.size) return;
    // Compete from every core over the original silhouette, restoring fine
    // tips to their nearest body. Color alone never erases a connected fin.
    labels.fill(0);let length=0;
    for(const core of cores) {
      if(core!==primary&&!discarded.has(core)&&!matchesBody(core)) continue;
      for(const p of core.pixels) {labels[p]=discarded.has(core)?2:1;queue[length++]=p;}
    }
    for(let head=0;head<length;head++) {
      const p=queue[head],x=p%width,y=Math.floor(p/width);
      for(const q of [x?p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1]) {
        if(q<0||labels[q]||data[q*4+3]<16) continue;
        labels[q]=labels[p];queue[length++]=q;
      }
    }
    for(let p=0;p<count;p++) if(labels[p]!==1) data[p*4+3]=0;
  }

  function cutout(input,width,height,{singleAnimal=false}={}) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>512||height>512||input.length!==width*height*4) {
      throw new Error("La imagen tiene dimensiones inválidas para el recorte.");
    }
    const data=new Uint8ClampedArray(input),bg=borderColor(data,width,height);
    if(bg) removeBackground(data,width,height,bg);
    if(singleAnimal) isolateAnimal(data,width,height);
    removeSpecks(data,width,height);
    let left=width,top=height,right=-1,bottom=-1,count=0;
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      if(data[(y*width+x)*4+3]<16) continue;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
    }
    if(count<Math.max(12,width*height*0.005)) throw new Error("La imagen quedó vacía o sin una silueta reconocible después del recorte.");
    if(bg&&count>width*height*0.85) throw new Error("El fondo ocupa la imagen: no se pudo aislar la silueta.");
    return {data,width,height,bounds:{x:left,y:top,width:right-left+1,height:bottom-top+1},
      clipped:left===0||top===0||right===width-1||bottom===height-1};
  }

  function fit(bounds,size,padding=0.06) {
    const scale=size*(1-padding*2)/Math.max(bounds.width,bounds.height);
    const width=bounds.width*scale,height=bounds.height*scale;
    return {x:(size-width)/2,y:(size-height)/2,width,height};
  }
  return {cutout,fit};
})();
