import assert from 'node:assert/strict';
import {validateBatch} from '../../packages/document-workspace/files.ts';

export const modelTaskCases=[
  {format:'docx',task:'Create an editable quarterly report: title Quarterly report, body Editable body and table remain structured., and a 3-row 2-column table with Region,Sales; North,120; South,180. Add a ReportTitle style based on Normal, bold, 20pt, color 174E43 and apply it to the title. Table width 9000 twips, equal column widths, fixed layout.',
    help:[{element:'style',fields:['id','name','basedOn','size','bold','color']},{element:'paragraph',fields:['text','style']},{element:'table',fields:['data','width','colWidths','layout']}],
    rules:[{command:'add',parent:'/styles',type:'style',fields:['id','name','basedOn','size','bold','color']},{command:'add',parent:'/body',type:'paragraph',fields:['text','style']},{command:'add',parent:'/body',type:'table',fields:['data','width','colWidths','layout']}],
    checks:[{args:['get','/body'],includes:['Quarterly report','Editable body and table remain structured.']},{args:['get','/body/tbl[1]','--depth','4'],includes:['Region','Sales','North','120','South','180'],rows:'3',cols:'2',expectedFormat:{width:'9000',layout:'fixed',colWidths:'4500dxa,4500dxa'}},{args:['query','paragraph[style=ReportTitle] > run'],includes:['Quarterly report'],expectedFormat:{'effective.size':'20pt','effective.bold':true,'effective.color':'#174E43'}}]},
  {format:'xlsx',task:'Create Data sheet, A1=10 and A2=20. In the default Sheet1 A1 use the formula SUM(Data!A1:A2), number format 0.00. Add an editable column chart on Sheet1 titled Sales with North=10, South=20, positioned x=3,y=1,width=12cm,height=7cm. Preserve the default sheet.',
    help:[{element:'sheet',fields:['name']},{element:'cell',fields:['value','formula','numberformat']},{element:'chart',fields:['chartType','title','data','categories','x','y','width','height']}],
    rules:[{command:'add',parent:'/',type:'sheet',fields:['name']},{command:'set',path:'/Data/A1',fields:['value']},{command:'set',path:'/Data/A2',fields:['value']},{command:'set',path:'/Sheet1/A1',fields:['formula','numberformat']},{command:'add',parent:'/Sheet1',type:'chart',fields:['chartType','title','data','categories','x','y','width','height']}],
    checks:[{args:['get','/Data/A1'],includes:['10'],expectedText:'10'},{args:['get','/Data/A2'],includes:['20'],expectedText:'20'},{args:['get','/Sheet1/A1'],includes:['SUM(Data!A1:A2)','0.00'],computed:'30'},{args:['get','/Sheet1/chart[1]'],includes:['Sales','North','South'],expectedFormat:{chartType:'column',title:'Sales'}}]},
  {format:'pptx',task:'Create exactly two editable slides: Overview with body Editable presentation and background #F6F5EF; Results with body Two-page deck and background #174E43. Add a native text shape Revenue 300 on the second slide, x=2cm,y=4cm,width=10cm,height=2cm, font size 28pt, color FFFFFF. Do not create images or external assets.',
    help:[{element:'slide',fields:['title','text','background']},{element:'shape',fields:['text','x','y','width','height','size','color']}],
    rules:[{command:'add',parent:'/',type:'slide',fields:['title','text','background']},{command:'add',parent:'/slide[2]',type:'shape',fields:['text','x','y','width','height','size','color']}],
    checks:[{args:['get','/slide[1]'],includes:['Overview','Editable presentation'],expectedFormat:{background:'#F6F5EF'}},{args:['get','/slide[2]'],includes:['Results','Two-page deck','Revenue 300'],expectedFormat:{background:'#174E43'},child:{text:'Revenue 300',type:'textbox',format:{x:'2cm',y:'4cm',width:'10cm',height:'2cm',size:'28pt',color:'#FFFFFF'}}}]},
] as const;

// This benchmark grants only its synthetic document plan, not arbitrary file/engine access.
export function validateModelTaskPlan(index:number,input:unknown){
  const scenario=modelTaskCases[index];assert.ok(scenario);
  const commands=validateBatch(input);assert.equal(commands.length,[4,5,3][index],'Task has exactly the requested elements');
  for(const command of commands){
    assert.ok(Object.keys(command).every(key=>['command','parent','path','type','props'].includes(key)),'Unexpected plan field');
    const rule=scenario.rules.find(rule=>rule.command===command.command&&('parent' in rule?command.parent===rule.parent:command.parent===undefined)&&('path' in rule?command.path===rule.path:command.path===undefined)&&('type' in rule?command.type===rule.type:command.type===undefined));
    assert.ok(rule,'Plan targets outside synthetic task');assert.ok(command.props&&Object.keys(command.props).length);
    for(const [key,value] of Object.entries(command.props)){
      assert.ok((rule.fields as readonly string[]).includes(key),'Unexpected property');
      assert.ok(['string','number','boolean'].includes(typeof value),'Non-scalar property');
      const text=String(value);assert.ok(text.length<=1000&&!/[\x00-\x1f]/.test(text)&&!/file:|https?:|[a-z]:\\|asset:|\.\.[\\/]/i.test(text),'External or oversized property');
      if(key==='formula')assert.equal(text,'SUM(Data!A1:A2)','Only the intended local arithmetic formula is allowed');
      if(key==='data')assert.equal(text,index===0?'Region,Sales;North,120;South,180':'Sales:10,20','Only synthetic inline data is allowed');
      if(key==='name'&&index===1)assert.equal(text,'Data');
      if(key==='id')assert.equal(text,'ReportTitle');
    }
  }
  const expected=index===0?[1,2,1]:index===1?[1,1,1,1,1]:[2,1];
  scenario.rules.forEach((rule,ruleIndex)=>assert.equal(commands.filter(command=>command.command===rule.command&&('parent' in rule?command.parent===rule.parent:true)&&('path' in rule?command.path===rule.path:true)&&('type' in rule?command.type===rule.type:true)).length,expected[ruleIndex],'Missing or duplicate task element'));
  return commands;
}

export function validateModelTaskReadback(check:{args:readonly string[];includes:readonly string[];rows?:string;cols?:string;computed?:string;expectedText?:string;expectedFormat?:Record<string,string|boolean>;child?:{text:string;type:string;format:Record<string,string>}},raw:string){
  for(const value of check.includes)assert.ok(raw.includes(value),`Missing task result: ${value}`);
  const data=JSON.parse(raw);assert.ok(data.success!==false);
  assert.equal(data.data.results.length,1,'Expected one exact task target');
  const target=data.data.results[0];
  if(check.expectedText!==undefined)assert.equal(target.text,check.expectedText,'Incorrect cell content');
  for(const [key,value] of Object.entries(check.expectedFormat||{}))assert.equal(target.format[key],value,`Incorrect task property: ${key}`);
  if(check.child){const children=target.children.filter((child:any)=>child.text===check.child!.text);assert.equal(children.length,1);assert.equal(children[0].type,check.child.type);for(const [key,value] of Object.entries(check.child.format))assert.equal(children[0].format[key],value,`Incorrect native shape property: ${key}`);}
  if(check.rows){const format=data.data.results[0].format;assert.equal(format.rows,check.rows);assert.equal(format.cols,check.cols);}
  if(check.computed)assert.equal(data.data.results[0].format.computedValue,check.computed);
}
