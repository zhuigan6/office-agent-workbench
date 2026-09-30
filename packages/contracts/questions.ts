import {AppError} from './index.ts';
export function questionAnswer(pending:any,input:any){
  if(!Array.isArray(pending?.questions)||!pending.questions.length)throw new AppError('NOT_A_QUESTION','This request is not a structured question.');
  if(input.decline===true){if(input.answers?.length)throw new AppError('INVALID_ANSWER','Decline must not include answers.');return {decline:true};}
  if(!Array.isArray(input.answers)||input.answers.length!==pending.questions.length)throw new AppError('INCOMPLETE_ANSWER','Answer every question or explicitly decline.');
  const seen=new Set<string>();
  const answers=input.answers.map((a:any)=>{
    const q=pending.questions.find((q:any)=>q.question===a.question);
    if(!q||seen.has(a.question)||!Array.isArray(a.labels)||!a.labels.length||a.labels.length>20||(!q.multiSelect&&a.labels.length!==1)||a.labels.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>4000))throw new AppError('INVALID_ANSWER','Answers must match the pending questions and selection limits.');
    seen.add(a.question);return {question:a.question,labels:a.labels};
  });
  return {answers};
}
