// A public SDK client is process-scoped so its OpenClaw identity is initialized
// only after the disposable profile environment has been installed.
const {GatewayClient}=await import('openclaw/plugin-sdk/gateway-runtime');
const url=process.env.LOOPS_GATEWAY_URL,token=process.env.LOOPS_GATEWAY_TOKEN;
if(!url||!token)throw Error('Disposable gateway endpoint and token are required.');

let client,ready=false,stopping=false,failed=false;
const send=value=>process.send?.(value);
const stop=async()=>{if(stopping)return;stopping=true;clearTimeout(startup);await client?.stopAndWait({timeoutMs:5000}).catch(()=>{});};
const fail=async error=>{if(failed||stopping)return;failed=true;send({type:'error',message:String(error?.message??error)});await stop();process.exit(1);};
const startup=setTimeout(()=>{void fail(Error('Gateway client startup timed out.'));},15000);
try{
  client=new GatewayClient({url,token,env:{...process.env},sharedStateMode:'read-only',clientName:'cli',mode:'cli',scopes:['operator.admin','operator.read','operator.write'],onHelloOk:()=>{if(ready||stopping)return;ready=true;clearTimeout(startup);send({type:'ready'});},onConnectError:error=>{void fail(error);}});
  client.start();
}catch(error){void fail(error);}

process.on('message',async message=>{
  if(message?.type==='stop'){await stop();send({type:'stopped'});process.exit(0);return;}
  if(message?.type!=='request'||!ready)return;
  try{send({type:'result',id:message.id,result:await client.request(message.method,message.params,{timeoutMs:message.timeoutMs??60000})});}
  catch(error){send({type:'result',id:message.id,error:String(error?.message??error)});}
});
process.on('disconnect',()=>{void stop();});
