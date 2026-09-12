import {describe,it,expect} from 'vitest';
import {repairGeneratedPolicy,configureLoopPolicy} from '../scripts/profile-policy.mjs';
const config=policy=>({plugins:{entries:{'loops-poc':{enabled:true,llm:policy}}},agents:{defaults:{model:{primary:'custom/selected'}}}});
describe('profile policy migration',()=>{
  it('removes only the exact generated single-model policies and is repeatable',()=>{
    for(const model of ['openai/gpt-6-astra','ollama/qwen3.5:4b']){
      const value=config({allowAgentIdOverride:true,allowModelOverride:true,allowedModels:[model],allowedCompletionModels:[model]});
      expect(repairGeneratedPolicy(value)).toBe(true);expect(repairGeneratedPolicy(value)).toBe(false);
      expect(value.plugins.entries['loops-poc'].llm).toEqual({allowAgentIdOverride:true,allowModelOverride:true});
      expect(value.agents.defaults.model.primary).toBe('custom/selected');
    }
  });
  it('preserves operator models and additional policy keys on repeated setup',()=>{
    for(const policy of [{allowedModels:['custom/special']},{allowModelOverride:false},{allowAgentIdOverride:true,allowModelOverride:true,allowedModels:['openai/gpt-6-astra'],allowedCompletionModels:['openai/gpt-6-astra'],allowAuthProfileOverride:false}]){
      const value=config(policy),before=structuredClone(value);configureLoopPolicy(value);configureLoopPolicy(value);expect(value).toEqual(before);
    }
  });
});
