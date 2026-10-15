import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {BUILTIN_TERMINATION_RECORDS,createCustomTerminationRecord} from './catalog';
import {TerminationRecordEditor} from './TerminationRecordEditor';
import {TerminationLibraryPicker} from './TerminationLibraryPicker';
import {TerminationSymbol} from './TerminationSymbol';
describe('termination picker/editor UI',()=>{
 it('renders selectable shapes without claiming fabricated articles or capacity',()=>{
  const html=renderToStaticMarkup(<TerminationLibraryPicker onSelect={()=>{}}/>);
  expect(html).toContain('Библиотека оконцовок');expect(html).toContain('>Выбрать</button>');expect(html).toContain('Артикул не задан');expect(html).toContain('Создать артикул');expect(html).toContain('preparation-socket-seal');
 });
 it('offers series dimensions, article fields and independently confirmed conductor conditions',()=>{
  const record=createCustomTerminationRecord(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId==='nshvi-double')!,'custom:ui');
  const html=renderToStaticMarkup(<TerminationRecordEditor record={record} onSave={()=>{}} onCancel={()=>{}}/>);
  for(const label of ['Производитель','Артикул','Размеры семейства','Длина зачистки','Разрешённые комбинации','Источник условий совместимости','Исполнение рисунка']){
   expect(html).toContain(label);
  }
  expect(html).toContain('Жёлтый');expect(html).toContain('Чёрный');expect(html).toContain('Неизвестно');
 });
 it('renders runtime SVG without exposing raw user markup',()=>{
  const html=renderToStaticMarkup(<TerminationSymbol record={{...BUILTIN_TERMINATION_RECORDS[0]!,name:'<script>bad</script>'}} view="e4"/>);
  expect(html).toContain('termination-symbols/nki-ring-e4.svg');expect(html).not.toContain('<script>');
 });
});
