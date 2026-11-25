/** Tool execution always creates a durable mission; no direct local tool loop. */
import {Router} from 'express';
import {submitMission} from '../planner/plannerRouter';
import {ENABLED_TOOLS} from '../planner/governedTools';
import {TOOL_REGISTRY,getTool} from './toolRegistry';
export const toolsRouter=Router();
toolsRouter.get("/", (req, res) => {
  res.json({ tools: TOOL_REGISTRY, count: TOOL_REGISTRY.length });
});

toolsRouter.post('/run', async (req,res,next)=>{
 if(req.header('Idempotency-Key')){
  req.body={...req.body,objective:req.body?.message};return submitMission(req,res,next);
 }
 const message = req.body?.message || req.body?.task || '';
 const sessionId = req.body?.session_id || 'default';
 const tenantId = (req as any).microfixdTenantId || 'global';
 try {
  const { getGroqClient, groqConfiguration } = await import('../orchestration/groqRuntime');
  const { executeGroqWithRetry } = await import('../orchestration/groqRetry');
  const { executeMemoryOrgan } = await import('../organs/organs/memoryOrgan');
  const { feedbackLoop } = await import('../orchestration/feedbackLoop');
  const groq = getGroqClient();
  const tools = [
   {type: 'function', function: {name: 'store_memory', description: 'Store memory', parameters: {type: 'object', properties: {content: {type: 'string'}}, required: ['content']}}},
   {type: 'function', function: {name: 'recall_memory', description: 'Recall memory', parameters: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']}}}
  ];
  const messages: any[] = [{role: 'user', content: message}];
  const firstCall = await executeGroqWithRetry(groq!, {
   model: groqConfiguration().model,
   messages,
   tools,
   max_tokens: 10000,
  });
  const toolCalls = firstCall.completion.choices[0]?.message?.tool_calls || [];
  const toolResults: any[] = [];
  messages.push(firstCall.completion.choices[0]?.message);
  for(const call of toolCalls){
   let resultStr = '';
   try {
    const args = JSON.parse(call.function.arguments);
    if(call.function.name === 'recall_memory'){
     const recalled = await executeMemoryOrgan('search', {session_id: sessionId, tenant_id: tenantId, query: args.query});
     resultStr = JSON.stringify(recalled);
    } else if(call.function.name === 'store_memory'){
     const stored = await executeMemoryOrgan('store', {session_id: sessionId, tenant_id: tenantId, content: args.content});
     resultStr = JSON.stringify(stored);
    }
   } catch(err: any) {
    resultStr = `error: ${err.message || String(err)}`;
   }
   toolResults.push({id: call.id, name: call.function.name, result: resultStr});
   messages.push({role: 'tool', tool_call_id: call.id, content: resultStr});
  }
  const finalCall = await executeGroqWithRetry(groq!, {
   model: groqConfiguration().model,
   messages,
   tools,
   max_tokens: 10000,
  });
  const finalContent = finalCall.content;
  await executeMemoryOrgan('store', {
   tenant_id: tenantId,
   session_id: sessionId,
   organ: 'tools',
   content: JSON.stringify({message, tool_results: toolResults, output: finalContent}),
   metadata: {session_id: sessionId}
  });
  await feedbackLoop.collect(sessionId, message, finalContent, {tools: toolResults}, tenantId);
  res.json({success: true, output: finalContent, tools_called: toolResults});
 } catch(err) {
  next(err);
 }
});
toolsRouter.post('/execute',(req,res,next)=>{
 const name=req.body?.tool_name,tool=getTool(name);
 if(!tool)return res.status(404).json({code:'UNKNOWN_TOOL'});
 if(!ENABLED_TOOLS.includes(name))return res.status(422).json({code:'UNSUPPORTED_DURABLE_TOOL'});
 const args=req.body.arguments??{};
 req.body={...req.body,objective:`Execute authorized tool ${name}`,tool_permissions:[name],plan:[{agent_id:null,tool_permissions:[name],input_context:{objective:`Execute ${name}`},expected_output_schema:{type:'object',required:['result'],properties:{result:{type:'object'}},additionalProperties:false},subtasks:[{agent_id:null,tool_request:{name,arguments:args},input:{}}]}]};
 return submitMission(req,res,next);
});
