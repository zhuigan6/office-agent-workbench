export function pptSlideBounds(geometry:any,size:any){
  const values=[geometry?.left,geometry?.top,geometry?.width,geometry?.height,geometry?.rotation,size?.width,size?.height];
  if(values.some(n=>typeof n!=='number'||!Number.isFinite(n))||geometry.width<=0||geometry.height<=0||size.width<=0||size.height<=0)return undefined;
  const angle=geometry.rotation*Math.PI/180,w=Math.abs(Math.cos(angle))*geometry.width+Math.abs(Math.sin(angle))*geometry.height,h=Math.abs(Math.sin(angle))*geometry.width+Math.abs(Math.cos(angle))*geometry.height,cx=geometry.left+geometry.width/2,cy=geometry.top+geometry.height/2;
  const bounds={left:cx-w/2,top:cy-h/2,right:cx+w/2,bottom:cy+h/2};
  return {method:'native-rotated-rectangle-estimate',slideWidth:size.width,slideHeight:size.height,bounds,mayClip:bounds.left<-.02||bounds.top<-.02||bounds.right>size.width+.02||bounds.bottom>size.height+.02,instruction:'Estimated shape bounds only, not shadow/3D/group extents or final visual quality. Inspect the actual slide.'};
}
