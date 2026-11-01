import { useEffect, useRef, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, type AgentEffort, type AgentModel, type AgentSetting, type CodexModel } from '../core/types';
import { ApiError, api } from './api';
import { useMenuClose } from './queue';
import { failText, t } from './strings';

/** A choice for this start only. The ordinary button continues to use the current default. */
export function StartAgent({ label, disabled, title, codexAllowed = true, onStart }: { label: string; disabled?: boolean; title?: string; codexAllowed?: boolean; onStart: (setting?: AgentSetting) => void }) {
  const [open, setOpen] = useState(false);
  const [setting, setSetting] = useState<AgentSetting | null>(null);
  const [models, setModels] = useState<CodexModel[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState<AgentSetting | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  const a = t.config.agents;
  const loadModels = async () => {
    setLoading(true); setError('');
    try { setModels(await api.codexModels()); } catch (e) { setError(e instanceof ApiError ? e.message : failText(e)); }
    setLoading(false);
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSetting(null); setInitial(null); setError(''); setModels(null);
    api.agents().then((v) => { if (active) { setSetting(v.agents.worker); setInitial(v.agents.worker); } }).catch((e) => { if (active) setError(e instanceof ApiError ? e.message : failText(e)); });
    return () => { active = false; };
  }, [open]);
  useEffect(() => { if (open && setting?.harness === 'codex') void loadModels(); }, [open, setting?.harness]);
  const codex = setting?.harness === 'codex';
  const choice = setting?.codex ?? { model: 'default', effort: 'high' as const };
  const selected = models?.find((m) => choice.model === 'default' ? m.isDefault : m.model === choice.model);
  const efforts = AGENT_EFFORTS.filter((e) => selected?.supportedReasoningEfforts.some((x) => x.reasoningEffort === e));
  const valid = !!setting && (!codex || (codexAllowed && !!selected && efforts.includes(choice.effort)));
  const describe = (s: AgentSetting) => s.harness === 'codex' ? `${a.harnesses.codex} · ${s.codex?.model ?? a.codexDefault} · ${a.efforts[s.codex?.effort ?? 'high']}` : `${a.harnesses.claude} · ${a.models[s.model]} · ${a.efforts[s.effort]}`;
  return <div className="start-agent" ref={box}>
    <div className="start-agent-buttons">
      <button className="btn primary" disabled={disabled} title={title} onClick={() => onStart()}>{label}</button>
      <button type="button" className="btn primary start-agent-chevron" disabled={disabled} aria-label={a.chooseStart} aria-expanded={open} title={a.chooseStart} onClick={() => setOpen(!open)}>⌄</button>
    </div>
    {open && <div className="start-agent-menu">
      {initial && <p className="hint">{a.currentDefault}: {describe(initial)}</p>}
      <p className="hint">{a.choiceHint}</p>
      {setting && <>
        <label>{a.harness}<select value={setting.harness ?? 'claude'} onChange={(e) => setSetting({ ...setting, harness: e.target.value as 'claude' | 'codex', ...(e.target.value === 'codex' ? { codex: setting.codex ?? choice } : {}) })}>
          <option value="claude">{a.harnesses.claude}</option><option value="codex" disabled={!codexAllowed}>{a.harnesses.codex}{!codexAllowed ? ` (${a.unavailable})` : ''}</option>
        </select></label>
        <label>{a.model}<select value={codex ? choice.model : setting.model} disabled={codex && (!models || loading)} onChange={(e) => {
          if (!codex) return setSetting({ ...setting, model: e.target.value as AgentModel });
          const model = models?.find((m) => e.target.value === 'default' ? m.isDefault : m.model === e.target.value);
          const supported = AGENT_EFFORTS.filter((x) => model?.supportedReasoningEfforts.some((y) => y.reasoningEffort === x));
          setSetting({ ...setting, codex: { model: e.target.value, effort: supported.includes(choice.effort) ? choice.effort : supported[0] ?? choice.effort } });
        }}>
          {codex ? <><option value="default">{a.codexDefault}</option>{choice.model !== 'default' && !models?.some((m) => m.model === choice.model) && <option value={choice.model}>{choice.model} ({a.unavailable})</option>}{models?.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</> : AGENT_MODELS.map((m) => <option key={m} value={m}>{a.models[m]}</option>)}
        </select></label>
        <label>{a.effort}<select value={codex ? choice.effort : setting.effort} disabled={codex && (!models || loading)} onChange={(e) => setSetting(codex ? { ...setting, codex: { ...choice, effort: e.target.value as AgentEffort } } : { ...setting, effort: e.target.value as AgentEffort })}>
          {codex && !efforts.includes(choice.effort) && <option value={choice.effort}>{a.efforts[choice.effort]} ({a.unavailable})</option>}
          {(codex ? efforts : AGENT_EFFORTS).map((e) => <option key={e} value={e}>{a.efforts[e]}</option>)}
        </select></label>
        {codex && <p className="hint">{a.codexScope}</p>}
      </>}
      {(error || loading) && <p className="p-error" role="status">{loading ? a.loadingModels : error} {error && setting?.harness === 'codex' && <button className="link" onClick={loadModels}>{a.reloadModels}</button>}</p>}
      {codex && models && !loading && !valid && <p className="p-error" role="status">{a.unavailableChoice}</p>}
      <button className="btn primary" disabled={!valid || loading} onClick={() => { if (setting) onStart(setting); setOpen(false); }}>{a.startWith}</button>
    </div>}
  </div>;
}
