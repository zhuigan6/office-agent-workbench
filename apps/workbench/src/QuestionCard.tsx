import React,{useState,useRef} from 'react';
export function QuestionCard({item,submit}:{item:any;submit:(body:any)=>Promise<void>}){
  const [choices,setChoices]=useState<Record<number,string[]>>({}),[text,setText]=useState<Record<number,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const submitting=useRef(false);
  async function answer(decline=false){
    if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
    try{
      const answers=item.questions.map((q:any,i:number)=>({question:q.question,labels:[...(choices[i]||[]),...(text[i]?.trim()?[text[i].trim()]:[])]}));
      if(!decline&&answers.some((a:any)=>!a.labels.length))throw Error('请回答每个问题，或选择暂不回答。');
      await submit({requestId:item.call_id,...(decline?{decline:true}:{answers})});
    }catch(e){setError(e instanceof Error?e.message:'回答未提交。');}
    finally{submitting.current=false;setBusy(false);}
  }
  return <section className="approval question-card" aria-label="智能体提问"><strong>{item.title || '请补充任务信息'}</strong>
    {item.questions.map((q:any,i:number)=><fieldset key={i} disabled={busy}><legend>{q.question}</legend>
      {(q.options||[]).map((o:any,j:number)=><label key={j}><input type={q.multiSelect?'checkbox':'radio'} name={`${item.id}-${i}`} checked={(choices[i]||[]).includes(o.label)} onChange={e=>{
        setChoices(old=>({...old,[i]:q.multiSelect?(e.target.checked?[...(old[i]||[]),o.label]:(old[i]||[]).filter(v=>v!==o.label)):[o.label]}));
        if(!q.multiSelect)setText(old=>({...old,[i]:''}));
      }}/><span>{o.label}{o.description&&<small>{o.description}</small>}</span></label>)}
      <label>自由回答<input aria-label={`自由回答：${q.question}`} maxLength={4000} value={text[i]||''} onChange={e=>{setText(old=>({...old,[i]:e.target.value}));if(!q.multiSelect)setChoices(old=>({...old,[i]:[]}));}}/></label>
    </fieldset>)}
    {error&&<p role="alert">{error}</p>}<button disabled={busy} onClick={()=>void answer()}>提交回答</button><button disabled={busy} onClick={()=>void answer(true)}>暂不回答</button>
  </section>;
}
