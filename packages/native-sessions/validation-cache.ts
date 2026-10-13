/** In-process protocol reuse only for identical freshly hashed runtime bytes. */
export class RuntimeValidationCache<T>{
  private completed:{key:string;value:T}|undefined;
  private pending:{key:string;promise:Promise<T>}|undefined;
  async get(key:string,inspect:()=>Promise<T>):Promise<{value:T;cacheHit:boolean}>{
    if(this.completed?.key===key)return {value:this.completed.value,cacheHit:true};
    if(this.pending?.key===key)return {value:await this.pending.promise,cacheHit:true};
    const promise=inspect();this.pending={key,promise};
    try{const value=await promise;if(this.pending?.promise===promise)this.completed={key,value};return {value,cacheHit:false};}
    finally{if(this.pending?.promise===promise)this.pending=undefined;}
  }
}
