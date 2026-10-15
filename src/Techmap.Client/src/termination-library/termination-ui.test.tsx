import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {BUILTIN_TERMINATION_RECORDS,createCustomTerminationRecord} from './catalog';
import {TerminationRecordTable} from './TerminationRecordTable';
import {TerminationLibrary} from './TerminationLibrary';
import {TerminationProperties} from './TerminationProperties';
import {createTerminationCatalogBinding} from './placement';
import {groupTerminationSeries,generateTerminationSeries} from './series';
import {TerminationSeriesTables} from './TerminationSeriesTables';
import {LibraryWorkspace} from '../component-library/LibraryWorkspace';
import {TerminationLibraryPicker} from './TerminationLibraryPicker';
import {TerminationSymbol} from './TerminationSymbol';
describe('termination picker/editor UI',()=>{
 it('renders selectable shapes without claiming fabricated articles or capacity',()=>{
  const html=renderToStaticMarkup(<TerminationLibraryPicker onSelect={()=>{}}/>);
  expect(html).toContain('Библиотека оконцовок');expect(html).toContain('>Выбрать</button>');expect(html).toContain('Артикул не задан');expect(html).not.toContain('Создать артикул');expect(html).not.toContain('Редактировать артикул');expect(html).toContain('preparation-socket-seal');
 });
 it('offers series dimensions, article fields and independently confirmed conductor conditions',()=>{
  const record=createCustomTerminationRecord(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId==='nshvi-double')!,'custom:ui');
  const html=renderToStaticMarkup(<TerminationRecordTable records={[record]} label="Артикулы" onChange={()=>{}}/>);
  for(const label of ['Производитель','Артикул','L, мм','Зачистка, мм','Комбинации сечений','Источник условий совместимости','Исполнение рисунка']){
   expect(html).toContain(label);
  }
  expect(html).toContain('Жёлтый');expect(html).toContain('Чёрный');expect(html).toContain('Неизвестно');
 });
 it('shows all catalog properties in one read-only row from the pinned snapshot',()=>{
  const record={...createCustomTerminationRecord(BUILTIN_TERMINATION_RECORDS[0]!,'custom:pinned'),article:'PIN-1',manufacturer:'Завод',material:'Медь',notes:'Сохранённое свойство',dimensionsMm:{...BUILTIN_TERMINATION_RECORDS[0]!.dimensionsMm,L:24}};
  const html=renderToStaticMarkup(<TerminationProperties binding={createTerminationCatalogBinding(record)}/>);
  expect(html).toContain('PIN-1');expect(html).toContain('Завод');expect(html).toContain('Сохранённое свойство');expect(html).toContain('>24</td>');
  expect((html.match(/<tbody><tr/g)??[])).toHaveLength(1);expect(html).not.toContain('<input');expect(html).not.toContain('<button');expect(html).not.toContain('<select');
 });
 it('keeps independent same-shape series as multiple tables on one page',()=>{
  const input={name:'Серия',manufacturer:'Завод A',assetId:'nki-ring',articlePattern:'A-{n}',count:2,start:1,step:1,padding:2};
  const a=generateTerminationSeries(input,'series:a'),b=generateTerminationSeries({...input,manufacturer:'Завод B'},'series:b');
  const html=renderToStaticMarkup(<TerminationSeriesTables groups={groupTerminationSeries([...a.records,...b.records],[a.series,b.series])} family="nki-ring" query=""/>);
  expect((html.match(/<table /g)??[])).toHaveLength(3);expect(html).toContain('Завод A');expect(html).toContain('Завод B');expect(html).not.toContain('<input');
 });
 it('exposes a permanent home destination and series generation without a delete action',()=>{
  const html=renderToStaticMarkup(<TerminationLibrary/>);
  expect(html).toContain('Генерировать серию');expect(html).toContain('Защищённый шаблон формы');expect(html).not.toContain('Удалить');
  const shell=renderToStaticMarkup(<LibraryWorkspace config={{configVersion:1,basePath:'/',apiBasePath:'/api/v1/',appVersion:'test',apiVersion:'1',schemaVersion:'1'}} session={{csrfNonce:'test',instanceId:'test'}}/>);
  expect(shell).toContain('Библиотека оконцовок');expect(shell).toContain('Соединители');
 });
 it('renders runtime SVG without exposing raw user markup',()=>{
  const html=renderToStaticMarkup(<TerminationSymbol record={{...BUILTIN_TERMINATION_RECORDS[0]!,name:'<script>bad</script>'}} view="e4"/>);
  expect(html).toContain('symbol-assets/nki-ring-e4.svg');expect(html).not.toContain('<script>');
 });
 it('keeps view controls, selection footer and local integration errors inside the picker',()=>{
  const html=renderToStaticMarkup(<TerminationLibraryPicker error="Выберите гильзу с двумя входами." onSelect={()=>{}}/>);
  expect(html).toContain('aria-label="Вид рисунка"');expect(html).toContain('termination-library-footer');expect(html).toContain('role="alert"');expect(html).toContain('Выберите гильзу с двумя входами.');
 });
});
