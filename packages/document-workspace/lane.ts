import {DocumentBroker} from './broker.ts';
import type {Operation} from '../contracts/index.ts';

// Compose existing handlers under one outer document queue without self-deadlock.
export async function inDocumentLane(broker:DocumentBroker,doc:string,id:string,run:(lane:DocumentBroker)=>Promise<Operation>){
  const promise=(broker.queues.get(doc)??Promise.resolve()).catch(()=>{}).then(()=>{
    const lane=new DocumentBroker(broker.store);lane.hosts=broker.hosts;return run(lane);
  });
  broker.queues.set(doc,promise);broker.inFlight.set(id,promise);
  try{return await promise;}finally{broker.inFlight.delete(id);if(broker.queues.get(doc)===promise)broker.queues.delete(doc);}
}
