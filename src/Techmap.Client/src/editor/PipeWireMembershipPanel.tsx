import { useEffect, useState } from 'react';
import { InfoHint } from '../InfoHint';
import type { HarnessDesignDocument } from './model';
import type { PhysicalTopology } from './physical-topology-model';
import { addPipeWires, removePipeWires, movePipeWires } from './physical-pipe-membership';
import './pipe-wire-membership.css';

export function PipeWireMembershipPanel({ document, selectedIds, onChange, onSelect }: {
  document: HarnessDesignDocument;
  selectedIds: readonly string[];
  onChange: (topology: PhysicalTopology) => boolean;
  onSelect: (id: string, additive?: boolean) => void;
}) {
  const topology = document.physicalTopology;
  const selectedPipe = topology?.segments.find(pipe => selectedIds.includes(pipe.id));
  const [chosenPipeId, setChosenPipeId] = useState('');
  const pipe = selectedPipe ?? topology?.segments.find(pipe => pipe.id === chosenPipeId);
  const [checked, setChecked] = useState<string[]>([]);
  const [candidate, setCandidate] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setChecked([]); setCandidate(''); setTarget(''); setError(''); }, [pipe?.id]);
  const selectedWires = document.wires.filter(wire => selectedIds.includes(wire.id));
  if (!topology?.segments.length || !pipe && !selectedWires.length) return null;
  const pipeLabel = (id: string) => `П${topology.segments.findIndex(pipe => pipe.id === id) + 1}`;
  const wireLabel = (id: string) => {
    const index = document.wires.findIndex(wire => wire.id === id);
    const wire = document.wires[index];
    return `W${index + 1}${wire?.circuit?.trim() ? ` · ${wire.circuit.trim()}` : ''}`;
  };
  const members = pipe ? topology.routes.filter(route => route.steps.some(step => step.segmentId === pipe.id)).map(route => route.wireId) : [];
  const picked = checked.filter(id => members.includes(id));
  const additions = selectedWires.filter(wire => !members.includes(wire.id)).map(wire => wire.id);
  const locked = document.views.drawing.layers.some(layer => layer.id === 'wires' && layer.locked);
  const apply = (change: () => PhysicalTopology) => {
    setError('');
    try { if (onChange(change())) { setChecked([]); setCandidate(''); } }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось изменить состав пайпа.'); }
  };
  return <section className="he-pipe-membership" aria-label="Состав пайпа">
    <header className="ui-section-heading"><strong>{pipe ? `Состав ${pipeLabel(pipe.id)} · ${members.length}` : 'Состав пайпа'}</strong>
      <InfoHint>Выделите П и провода с Ctrl, затем добавьте их в П. Можно выбрать провод из списка ниже. Отметьте провод в составе, чтобы исключить его или перенести в другой П. Маршрут должен непрерывно соединять его электрические концы через выбранный П. Если соединяющих участков нет, сначала достройте их. Связи Э4 и заданные длины сохраняются.</InfoHint>
    </header>
    {!selectedPipe && <label>Пайп<select aria-label="Пайп для изменения состава" value={pipe?.id ?? ''} onChange={event => setChosenPipeId(event.target.value)}>
      <option value="">Выберите П…</option>{topology.segments.map(item => <option key={item.id} value={item.id}>{pipeLabel(item.id)}</option>)}
    </select></label>}
    {pipe && <>
      <button className="ui-control" type="button" disabled={locked || !additions.length} onClick={() => apply(() => addPipeWires(document, pipe.id, additions))}>Добавить выделенные провода ({additions.length})</button>
      <div className="he-pipe-membership-add"><select aria-label={`Добавить провод в ${pipeLabel(pipe.id)}`} value={candidate} onChange={event => setCandidate(event.target.value)} disabled={locked}>
        <option value="">Выберите провод…</option>{document.wires.filter(wire => !members.includes(wire.id)).map(wire => <option key={wire.id} value={wire.id}>{wireLabel(wire.id)}</option>)}
      </select><button className="ui-control" type="button" disabled={locked || !candidate || members.includes(candidate)} onClick={() => apply(() => addPipeWires(document, pipe.id, [candidate]))}>Добавить в П</button></div>
      <div className="he-pipe-membership-list" aria-label={`Провода в ${pipeLabel(pipe.id)}`}>
        {members.map(id => <label key={id}><input type="checkbox" aria-label={`Выбрать ${wireLabel(id)} в составе ${pipeLabel(pipe.id)}`} checked={picked.includes(id)} onChange={event => {
          setChecked(event.target.checked ? [...picked, id] : picked.filter(value => value !== id));
          if (event.target.checked) onSelect(id, true);
        }}/><span>{wireLabel(id)}</span></label>)}
        {!members.length && <small>В пайпе пока нет проводов.</small>}
      </div>
      <button className="ui-control" type="button" disabled={locked || !picked.length} onClick={() => apply(() => removePipeWires(document, pipe.id, picked))}>Исключить из П ({picked.length})</button>
      <div className="he-pipe-membership-add"><select aria-label="Перенести провода в пайп" value={target} onChange={event => setTarget(event.target.value)} disabled={locked}>
        <option value="">Другой П…</option>{topology.segments.filter(item => item.id !== pipe.id).map(item => <option key={item.id} value={item.id}>{pipeLabel(item.id)}</option>)}
      </select><button className="ui-control" type="button" disabled={locked || !picked.length || !target || target === pipe.id} onClick={() => apply(() => movePipeWires(document, pipe.id, target, picked))}>Перенести в П</button></div>
      {locked && <small>Разблокируйте слой проводов для изменения состава.</small>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
