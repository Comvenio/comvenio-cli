export function mcpAppsBridgeClientSource(appName: string): string {
  const serializedAppName = JSON.stringify(appName);
  return String.raw`
const MCP_APPS_PROTOCOL_VERSION="2026-01-26";
let mcpAppsInitId=null,mcpAppsReady=false,mcpAppsGeneration=0;
const mcpAppsQueue=[];
const mcpAppsRecord=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const postMcpAppsMessage=message=>window.parent.postMessage(message,"*");
const callMcpAppsTool=(name,args,id)=>{const message={jsonrpc:"2.0",id,method:"tools/call",params:{name,arguments:args}};if(mcpAppsReady)postMcpAppsMessage(message);else mcpAppsQueue.push(message)};
const handleMcpAppsBridgeMessage=message=>{if(!mcpAppsRecord(message)||message.jsonrpc!=="2.0"||message.id!==mcpAppsInitId)return false;if(mcpAppsRecord(message.error)){mcpAppsInitId=null;mcpAppsReady=false;mcpAppsQueue.length=0;status("Verbindung zum Widget fehlgeschlagen","Die MCP-App konnte nicht initialisiert werden. Bitte versuche es erneut.",true);return true}mcpAppsInitId=null;mcpAppsReady=true;postMcpAppsMessage({jsonrpc:"2.0",method:"ui/notifications/initialized"});while(mcpAppsQueue.length)postMcpAppsMessage(mcpAppsQueue.shift());return true};
const initializeMcpAppsBridge=()=>{const generation=++mcpAppsGeneration;mcpAppsReady=false;mcpAppsQueue.length=0;mcpAppsInitId="ui-init-"+generation+"-"+Date.now();postMcpAppsMessage({jsonrpc:"2.0",id:mcpAppsInitId,method:"ui/initialize",params:{protocolVersion:MCP_APPS_PROTOCOL_VERSION,appInfo:{name:${serializedAppName},version:"1.0.0"},appCapabilities:{}}});window.setTimeout(()=>{if(generation===mcpAppsGeneration&&!mcpAppsReady&&mcpAppsInitId!==null){mcpAppsInitId=null;mcpAppsQueue.length=0;status("Widget-Verbindung unterbrochen","Die MCP-App hat nicht rechtzeitig geantwortet. Bitte versuche es erneut.",true)}},8000)};
`;
}
