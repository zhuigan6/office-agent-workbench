export class HealthMonitor {
  private failures=0;
  private busy=false;
  private stopped=false;
  private degraded=false;
  private timer?:ReturnType<typeof setInterval>;
  constructor(private probe:()=>Promise<boolean>,private report:(healthy:boolean)=>void,private threshold=3){}
  start(interval=30000){this.timer=setInterval(()=>void this.tick(),interval);this.timer.unref();}
  async tick(){
    if(this.stopped||this.busy)return;
    this.busy=true;
    let healthy=false;
    try{healthy=await this.probe();}catch{}
    finally{this.busy=false;}
    if(this.stopped)return;
    this.failures=healthy?0:this.failures+1;
    if(this.failures>=this.threshold){this.degraded=true;this.report(false);}
    else if(healthy&&this.degraded){this.degraded=false;this.report(true);}
  }
  stop(){this.stopped=true;clearInterval(this.timer);}
}
