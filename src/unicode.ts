/** Return at most limit Unicode code points without splitting a surrogate pair. */
export function truncateCodePoints(value:string,limit:number):string{
  let end=0,count=0;
  for(const character of value){
    if(count===limit)break;
    end+=character.length;count++;
  }
  return value.slice(0,end);
}
