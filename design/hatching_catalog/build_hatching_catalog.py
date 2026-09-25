from pathlib import Path
from html import escape as E
import json, math, textwrap, csv, shutil

OUT=Path(__file__).resolve().parent
OUT.mkdir(exist_ok=True)
(OUT/'samples').mkdir(exist_ok=True)
src=json.loads((OUT/'hatch_sources.json').read_text(encoding='utf-8'))
lookup={x['name']:x for x in src}
inventory=json.loads((OUT/'qcad_patterns.json').read_text(encoding='utf-8'))

# Meanings are described separately from geometry. CAD names are not ISO material codes.
rows=[
('ansi31','Одинарная диагональная', 'Равномерные сплошные линии под 45°.', 'Общее обозначение сечения. Сам рисунок не определяет материал.',3),
('ansi32','Парная диагональная', 'Пары линий под 45° с увеличенным промежутком между парами.', 'В ряде CAD-библиотек связана со сталью; назначение закрепляют в легенде.',2),
('ansi33','Сплошная и прерывистая', 'Сплошная линия чередуется с короткими штрихами под 45°.', 'Традиционно встречается для латуни, бронзы и меди; это не код ISO.',2.5),
('ansi34','Четыре линии в группе', 'Повторяющиеся группы из четырёх параллельных линий.', 'В CAD встречается для пластмасс и резины. Марку указывают отдельно.',1.6),
('ansi35','Диагональная с точками', 'Сплошные диагонали и ряды «штрих — точка».', 'Традиционная ассоциация с огнеупорными материалами в CAD.',2.3),
('ansi36','Смещённая штрихпунктирная', 'Диагональные ряды штрихов и точек со сдвигом фазы.', 'В CAD встречается для мрамора, сланца и стекла; нужна легенда.',2.5),
('ansi37','Перекрёстная сетка', 'Два семейства сплошных диагоналей под 45° и 135°.', 'В ряде CAD-библиотек — свинец, цинк, магний. Не универсальный знак.',3),
('ansi38','Сетка с прерывистой ветвью', 'Сплошные диагонали пересекаются с прерывистыми.', 'В CAD традиционно связывается с алюминием; материал — по спецификации.',3),
('steel','Сталь: парные линии', 'Пары диагональных линий с небольшим внутренним зазором.', 'Материальный CAD-узор STEEL. Не заменяет указание марки стали.',3),
('brass','Латунь: полосы и штрихи', 'Горизонтальные сплошные и прерывистые ряды.', 'Материальный CAD-узор BRASS для легенд и сечений.',3),
('plast','Пластик: тройные полосы', 'Группы из трёх близких горизонтальных линий.', 'Материальный CAD-узор PLAST. Состав полимера из рисунка не следует.',4),
('plasti','Пластик: полосы с разделителем', 'Тройная группа и отдельная линия в каждом периоде.', 'Вариант PLASTI; выбирается правилами конкретной документации.',4),
('cork','Пробка', 'Горизонтальные линии с группами коротких наклонных штрихов.', 'Условное изображение пробкового материала в CAD.',3),
('insul','Изоляция', 'Сплошной горизонтальный ряд и два прерывистых ряда.', 'CAD-узор INSUL для изоляционных слоёв, с пояснением материала.',3),
('flex','Гибкий материал', 'Разорванные горизонтали с короткими наклонными соединениями.', 'Условная фактура гибкой прослойки или вставки. Не знак конкретного полимера.',3),
('jis_wood','Древесина: JIS_WOOD', 'Простая равномерная диагональная штриховка.', 'Имя из CAD-библиотеки с префиксом JIS. Это не рисунок годичных колец.',12),
('ar-conc','Бетон', 'Нерегулярное сочетание треугольных включений, точек и штрихов.', 'Архитектурный CAD-узор бетонного заполнителя.',.65),
('ar-sand','Песок', 'Точки с неодинаковыми интервалами и смещением рядов.', 'Зернистые засыпки и песчаные слои на строительных деталях.',.6),
('earth','Грунт', 'Чередующиеся группы коротких горизонтальных и вертикальных штрихов.', 'Земля и грунтовые слои; конкретный вид грунта задают подписью.',3),
('gravel','Гравий', 'Нерегулярные замкнутые угловатые фрагменты.', 'Гравийная засыпка и крупный заполнитель.',3),
('clay','Глина', 'Группы горизонтальных сплошных линий и отдельный штриховой ряд.', 'Глинистый материал в условной CAD-легенде.',4),
('dolmit','Доломит', 'Горизонтальные слои и редкие наклонные короткие штрихи.', 'Геологическая или строительная легенда для доломита.',3),
('mudst','Аргиллит / глинистая порода', 'Горизонтальные штрихи и точки в смещённых рядах.', 'Узор MUDST для схем слоистых осадочных пород.',2.3),
('grass','Травяной покров', 'Трёхлучевые группы коротких штрихов.', 'Озеленение и условное изображение травы на планах.',1.4),
('brick','Кирпичная кладка', 'Прямоугольные ряды со смещением поперечных швов.', 'Условная кладка; геометрия образца не задаёт размер кирпича.',3),
('brstone','Полосовая каменная кладка', 'Горизонтальные ряды, парные вертикальные грани и короткая фактура.', 'CAD-узор BRSTONE для каменной облицовки и кладки.',2.5),
('ar-b816','Блоки 8 × 16: контур', 'Крупные прямоугольные ряды с перевязкой.', 'Архитектурный модуль с номинальным именем 8 × 16 дюймов.',.14),
('ar-b816c','Блоки 8 × 16: со швом', 'Перевязка прямоугольных блоков с видимой шириной швов.', 'Вариант AR-B816C; растворные швы читаются отдельными зазорами.',.14),
('ar-b88','Блоки 8 × 8', 'Квадратные модули со смещёнными стыками рядов.', 'Архитектурный CAD-узор для блочной кладки.',.14),
('ar-brelm','Английская перевязка', 'Чередование длинных и коротких модулей с растворными швами.', 'Условное изображение английской кирпичной перевязки.',.28),
('ar-brstd','Обычная кирпичная перевязка', 'Узкие горизонтальные ряды с регулярным смещением вертикальных швов.', 'Архитектурный CAD-образец кирпичной кладки.',.3),
('ar-hbone','Кладка «ёлочкой»', 'Взаимно перпендикулярные вытянутые элементы под 45°.', 'Мощение и укладка прямоугольных элементов «ёлочкой».',.18),
('ar-parq1','Квадратный паркет', 'Блоки параллельных планок с чередованием направления на 90°.', 'Условное изображение паркетного покрытия.',.14),
('ar-rroof','Кровля: нерегулярные ряды', 'Прерывистые горизонтальные линии разной длины и шага.', 'Условная фактура кровельной поверхности; система определяется легендой.',.35),
('ar-rshke','Кровельный гонт', 'Неравномерные узкие элементы со смещёнными горизонтальными кромками.', 'Условное изображение деревянного гонта или дранки.',.14),
('line','Параллельные горизонтали', 'Одно семейство равномерных сплошных линий.', 'Нейтральная заливка области, направление слоёв или полос.',3),
('net','Прямоугольная сетка', 'Горизонтальные и вертикальные линии с одинаковым шагом.', 'Сетка, модульное покрытие или различение зон по легенде.',4),
('net3','Треугольная сетка', 'Три семейства линий: 0°, 60° и 120°.', 'Треугольная ячеистая структура или нейтральная зональная заливка.',5),
('dots','Регулярные точки', 'Равномерная точечная решётка со смещением рядов.', 'Нейтральная фактура; не определяет зернистость реального материала.',5),
('cross','Крестики', 'Повторяющиеся изолированные кресты.', 'Зональное выделение или специальная легенда документа.',3),
('dash','Короткие штрихи', 'Горизонтальные штриховые ряды со сдвигом.', 'Нейтральная условная заливка или обозначение зоны.',4),
('angle','Уголки', 'Повторяющиеся прямые углы из двух коротких отрезков.', 'Геометрическая фактура для различения областей.',3),
('grate','Прямоугольная решётка', 'Плотные горизонтальные и более редкие вертикальные линии.', 'Условное изображение решётчатой поверхности.',5),
('hex','Раздельные шестигранники', 'Шестиугольные фигуры с промежутками между ними.', 'Геометрический узор; материал назначается легендой.',4),
('honey','Сотовая структура', 'Смежные шестигранные ячейки.', 'Условная сотовая поверхность или структура заполнителя.',4),
('square','Раздельные квадраты', 'Квадраты, составленные из ортогональных штрихов.', 'Геометрический CAD-узор, не знак конкретного материала.',5),
('triang','Раздельные треугольники', 'Повторяющиеся треугольные контуры.', 'Нейтральный рисунок для области или структуры.',4),
('zigzag','Ступенчатый зигзаг', 'Соединённые горизонтальные и вертикальные штрихи.', 'Геометрический CAD-узор; назначение задаётся в легенде.',4),
]
assert len(rows)==48 and {r[0] for r in rows}==set(lookup)

def clip(x,y,dx,dy,w,h):
    lo,hi=-1e30,1e30
    for p,v,b in [(x,dx,w),(y,dy,h)]:
        if abs(v)<1e-10:
            if p<0 or p>b:return None
        else:
            a,c=sorted((-p/v,(b-p)/v));lo=max(lo,a);hi=min(hi,c)
    return (lo,hi) if lo<=hi else None

def geometry(name,scale,w=420,h=155):
    # PAT displacement is expressed in the local coordinate system of each line.
    # Lines are rendered in mathematical coordinates, then mirrored into SVG y.
    paths=[];dots=[]
    def seg(x,y,ux,uy,a,b):
        if b-a<.015:return
        paths.append(f'M{x+a*ux:.2f},{h-y-a*uy:.2f}L{x+b*ux:.2f},{h-y-b*uy:.2f}')
    for raw in lookup[name]['text'].splitlines():
        if not raw.strip() or raw.startswith(('*',';')):continue
        vals=[float(s.strip()) for s in raw.split(',')]
        ang,x,y,sx,sy=vals[:5];dash=[z*scale for z in vals[5:]]
        x*=scale;y*=scale;sx*=scale;sy*=scale
        ux,uy=math.cos(math.radians(ang)),math.sin(math.radians(ang))
        nx,ny=-uy,ux
        normal=[nx*px+ny*py for px,py in [(0,0),(w,0),(0,h),(w,h)]]
        base=nx*x+ny*y
        if abs(sy)<1e-9:continue
        lower,upper=sorted(((min(normal)-base)/sy,(max(normal)-base)/sy))
        for n in range(math.floor(lower)-1,math.ceil(upper)+2):
            px=x+n*(sx*ux+sy*nx);py=y+n*(sx*uy+sy*ny)
            ran=clip(px,py,ux,uy,w,h)
            if ran is None:continue
            a,b=ran
            if not dash:seg(px,py,ux,uy,a,b);continue
            period=sum(abs(d) for d in dash)
            if period<=0:continue
            for k in range(math.floor(a/period)-1,math.ceil(b/period)+1):
                pos=k*period
                for d in dash:
                    if d>0:
                        aa,bb=max(a,pos),min(b,pos+d)
                        if bb>aa:seg(px,py,ux,uy,aa,bb)
                    elif d==0 and a<=pos<=b:
                        dots.append(f'<circle cx="{px+pos*ux:.2f}" cy="{h-py-pos*uy:.2f}" r=".78"/>')
                    pos+=abs(d)
    return f'<path d="{" ".join(paths)}" fill="none" stroke="currentColor" stroke-width=".9" stroke-linecap="butt"/>'+''.join(dots)

geoms={r[0]:geometry(r[0],r[4]) for r in rows}

def svg(w,h,b,title):return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><title>{E(title)}</title>{b}</svg>'
def txt(x,y,s,size=18,color='#27322f',weight=400,extra=''):
    return f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" {extra}>{E(s)}</text>'

groups=['Линейные узоры ANSI','Материальные CAD-узоры','Грунты и заполнители','Кладка и мощение','Покрытия и базовые сетки','Геометрические узоры']
metadata=[]
for i,r in enumerate(rows):
    name,title,desc,use,scale=r;code=f'H{i+1:02}'
    g=geoms[name]
    (OUT/'samples'/f'{code}_{name}.svg').write_text(svg(420,155,'<rect width="420" height="155" fill="#fff"/><g color="#202523">'+g+'</g>',title),encoding='utf-8',newline='\n')
    metadata.append(dict(code=code,name=name.upper(),title=title,description=desc,usage=use,group=groups[i//8],source=lookup[name]['url'],source_sha=lookup[name]['sha'],scale_preview=scale,status='CAD-библиотека QCAD; не аттестованный знак ISO/DIN'))

# Six readable plates: 8 illustrated entries per page.
for page in range(6):
    b='<rect width="1600" height="1840" fill="#f4f5f1"/>'
    b+=txt(68,58,'ШТРИХОВКИ / ИЛЛЮСТРИРОВАННЫЙ КАТАЛОГ',15,'#69746d',600,extra='letter-spacing="2"')
    b+=txt(68,113,groups[page],38,'#1d2923',600)
    b+=txt(68,148,'Образцы построены по открытым PAT-определениям QCAD. Масштаб подобран для читаемости.',19,'#65716a')
    for j in range(8):
        idx=page*8+j;m=metadata[idx];r=rows[idx];x=68+(j%2)*748;y=185+(j//2)*383
        b+=f'<g transform="translate({x} {y})"><rect width="716" height="355" rx="7" fill="#fff" stroke="#d7ddd6"/>'
        b+=txt(25,35,m['code']+'  /  '+m['name'],17,'#63716a',600)
        b+=txt(25,73,m['title'],24,'#202c25',600)
        b+='<g transform="translate(25 96)"><rect width="666" height="144" fill="#fafbf8" stroke="#e3e6e0"/>'
        b+=f'<g color="#252c27">{geometry(r[0],r[4],666,144)}</g></g>'
        for n,s in enumerate(textwrap.wrap(m['description'],65)):b+=txt(25,267+n*23,s,18,'#4c5a52')
        for n,s in enumerate(textwrap.wrap(m['usage'],75)):b+=txt(25,314+n*20,s,15,'#69766d')
        b+='</g>'
    b+=txt(68,1785,'Имя CAD-узора не подтверждает соответствие стандарту материала. Назначение закрепляется в легенде проекта.',16,'#607066')
    b+=txt(1532,1785,f'{page+1:02} / 06',17,'#607066',extra='text-anchor="end"')
    (OUT/f'plate_{page+1:02}.svg').write_text(svg(1600,1840,b,groups[page]),encoding='utf-8',newline='\n')

# Compact full index: each code resolves to the illustrated detailed description.
b='<rect width="1760" height="2070" fill="#f4f5f1"/>'
b+=txt(56,52,'ШТРИХОВКИ / ОБЗОР 48 ОБРАЗЦОВ',15,'#67756d',600,extra='letter-spacing="2"')
b+=txt(56,104,'От сечения детали до строительной легенды',35,'#1c2b23',600)
b+=txt(56,139,'Коды H01–H48 соответствуют подробным описаниям в каталоге. Источник геометрии: QCAD.',18,'#64756b')
for idx,m in enumerate(metadata):
    r=rows[idx];x=56+(idx%4)*420;y=176+(idx//4)*150
    b+=f'<g transform="translate({x} {y})"><rect width="388" height="130" fill="#fff" stroke="#d7dfd5" rx="4"/>'
    b+=txt(15,25,m['code']+' / '+m['name'],14,'#65796a',600)
    b+=f'<g transform="translate(15 36)" color="#27382c">{geometry(r[0],r[4],358,53)}</g>'
    b+=txt(15,115,m['title'],15,'#29372e')+'</g>'
b+=txt(56,2022,'CAD-узоры не являются универсальными знаками материалов ISO/DIN. Назначение определяет легенда проекта.',16,'#66776a')
(OUT/'overview_48.svg').write_text(svg(1760,2070,b,'Обзор 48 штриховок'),encoding='utf-8',newline='\n')

# A single portable catalog with all images inline and no external runtime.
cards=[]
for i,m in enumerate(metadata):
    name=rows[i][0]
    cards.append(f'''<article class="card" data-search="{E((m['name']+' '+m['title']+' '+m['description']+' '+m['usage']).lower())}" data-group="{i//8}">
<div class="code">{m['code']} / {m['name']}</div><h2>{m['title']}</h2>
<svg viewBox="0 0 420 155" role="img" aria-label="{E(m['description'])}">{geoms[name]}</svg>
<p>{m['description']}</p><p class="use">{m['usage']}</p>
<div class="links"><span>CAD-библиотека</span><a href="{m['source']}" target="_blank" rel="noopener">Исходное определение</a><a href="samples/{m['code']}_{name}.svg" download>SVG</a></div></article>''')

head='''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>48 штриховок для чертежей</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f5f1;color:#202c25;font:16px/1.55 Arial,sans-serif}main{max-width:1400px;margin:auto;padding:42px 32px}.eyebrow{letter-spacing:2px;color:#657468;font-size:13px}h1{font-size:44px;line-height:1.15;max-width:1000px;margin:16px 0}header p{max-width:1100px;color:#57645b}.lead{font-size:20px}.toolbar{display:flex;gap:20px;align-items:end;flex-wrap:wrap;padding:22px 0;border-top:1px solid #d7ddd4;margin-top:25px}label{display:grid;gap:7px}input,select,button{font:inherit;padding:11px 13px;border:1px solid #b9c5b9;border-radius:5px;background:white;color:#203024}input{min-width:280px}button{cursor:pointer}#count{margin-left:auto;color:#5b6c60}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.card{padding:22px;border:1px solid #d7ddd4;border-radius:7px;background:white;display:flex;flex-direction:column;gap:10px;break-inside:avoid}.card[hidden]{display:none}.code{font-size:13px;letter-spacing:1px;color:#617469}.card h2{font-size:20px;line-height:1.3;margin:0;min-height:52px;font-weight:600}.card svg{display:block;width:100%;height:145px;background:#fafbf8;color:#202c25;border:1px solid #e1e7df}.card p{margin:0;font-size:15px}.card .use{font-size:14px;color:#607067}.links{display:flex;flex-wrap:wrap;gap:7px 14px;font-size:12px;margin-top:auto;padding-top:10px}.links span{color:#5c6c60}a{color:#26634f}section.notes{padding:32px 0}.notes p{max-width:1050px}details{padding:16px 0;border-top:1px solid #d7ddd4}summary{cursor:pointer;font-weight:600}.inventory{font-family:Consolas,monospace;line-height:1.9;word-break:break-word}footer{color:#627167;font-size:13px;padding:25px 0}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){main{padding:22px 16px}.grid{grid-template-columns:1fr}h1{font-size:33px}.toolbar>label{width:100%}input{min-width:0}#count{margin-left:0}}@media print{body{background:white}main{padding:0}.toolbar,.links{display:none}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card{break-inside:avoid}.notes{break-before:page}h1{font-size:30px}}</style></head><body><main>
<header><div class="eyebrow">ЧЕРТЕЖИ И ДОКУМЕНТАЦИЯ / СПРАВОЧНИК</div><h1>48 штриховок с описаниями и текстурами</h1><p class="lead">Материалы, кладка, покрытия и геометрические заливки. 127 названий из проверенной библиотеки — в полном перечне ниже.</p><p>Единого перечня всех существующих штриховок нет. Здесь показаны реальные узоры открытой CAD-библиотеки QCAD, а не 48 обязательных обозначений ISO/DIN. Значение рисунка согласуется с легендой документа.</p></header>
<div class="toolbar"><label>Название, материал или код<input id="search" type="search" placeholder="Например: бетон, ANSI, сетка"></label><label>Группа<select id="group"><option value="">Все группы</option>'''
head+=''.join(f'<option value="{i}">{s}</option>' for i,s in enumerate(groups))
head+='</select></label><button id="print" type="button">Печать каталога</button><span id="count" aria-live="polite">48 из 48</span></div><div class="grid" id="grid">'

notes='''<section class="notes"><h2>Как связаны ISO, DIN, ГОСТ и CAD-имена</h2>
<p><strong>ISO 128-2 / DIN EN ISO 128-2</strong> задают общую систему линий. <strong>ISO 128-3 / DIN EN ISO 128-3</strong> относятся к видам, сечениям и разрезам. Это общая рамка оформления, а не соответствие «каждому веществу — собственная фактура».</p>
<p>Обычная штриховка сечения — равномерные тонкие параллельные линии, часто под 45°. Различение соседних деталей выполняют направлением и/или шагом. Шаг выбирают по размеру зоны и читаемости на выпускном масштабе. Перекрёстная сетка не является обязательной штриховкой любого сложного участка, а чёрная заливка не означает автоматически сталь.</p>
<p><strong>ГОСТ 2.306-68</strong> — отдельный источник графических обозначений материалов в ЕСКД. Таблицы ГОСТ и CAD-узоры нельзя механически смешивать. Для строительных, геологических, топографических и иных документов применяются также профильные стандарты и легенды.</p>
<p>ANSI31–38 и JIS_WOOD здесь являются именами файлов выбранной библиотеки. Традиционные ассоциации материалов приведены как справочные, без заявления о проверке по оригиналам ANSI/JIS. Тексты ISO/DIN в этой сессии целиком не были доступны; каталог не является свидетельством соответствия нормативной документации.</p>
<p><strong>Масштаб рисунков условный.</strong> Номинальные размеры в именах AR-B816 и AR-B88 не должны заменять размеры в проекте. Нельзя по узору установить марку стали, полимера, породы или требования к монтажу.</p>
<p>Данный набор охватывает распространённые инженерные и строительные CAD-заливки. Картографические, литологические и специальные отраслевые легенды не исчерпываются этой библиотекой.</p>
<details open><summary>Источники и проверка</summary><p>Геометрия всех 48 образцов построена из опубликованных определений <a href="https://github.com/qcad/qcad/tree/master/patterns/metric">QCAD / patterns / metric</a>. Ссылка на конкретный файл есть в каждой карточке; контрольная SHA исходного файла сохранена в catalog.json. Полный список включает 127 файлов из этой же папки по полученному ответу GitHub API.</p><p>Источники для выбора нормативной системы: <a href="https://www.iso.org/obp/ui/#iso:std:iso:128:-3:ed-2:v1:en">ISO 128-3 в ISO OBP</a>, <a href="https://www.dinmedia.de/en">каталог DIN Media</a>. Доступность и редакция нормативного документа проверяются отдельно перед выпуском КД.</p><p>QCAD сообщает GPL v3 с возможными исключениями в <a href="https://github.com/qcad/qcad/blob/master/LICENSE.txt">LICENSE.txt</a>; текст лицензии: <a href="https://github.com/qcad/qcad/blob/master/gpl-3.0.txt">GPL-3.0</a>. Исходные PAT-определения сохранены в hatch_sources.json вместе с SHA. Лицензионное уведомление и текст GPL-3.0 включены рядом; подробности — в SOURCES.md. Автор геометрических определений — проект QCAD / соответствующие правообладатели. Перевод, описания, оформление и отрисовка подготовлены для этого каталога.</p></details>
<details><summary>Полный перечень 127 имён из QCAD</summary><p class="inventory">'''
notes+=' · '.join(E(x['name'].removesuffix('.pat').upper()) for x in inventory)
notes+='''</p></details></section><footer>Версия 1 · Проверка источников: 26.09.2026 · Все образцы — чёрно-белые и масштабируемые.</footer></main>
<script>const search=document.getElementById('search'),group=document.getElementById('group'),count=document.getElementById('count'),cards=Array.from(document.querySelectorAll('.card'));function apply(){let n=0;const q=search.value.trim().toLocaleLowerCase('ru');for(const c of cards){const show=(!q||c.dataset.search.includes(q))&&(!group.value||c.dataset.group===group.value);c.hidden=!show;if(show)n++;}count.textContent=n+' из '+cards.length;}search.addEventListener('input',apply);group.addEventListener('change',apply);document.getElementById('print').addEventListener('click',()=>window.print());</script></body></html>'''
(OUT/'catalog.html').write_text(head+'\n'.join(cards)+notes,encoding='utf-8',newline='\n')
(OUT/'catalog.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
(OUT/'inventory_127.txt').write_text('\n'.join(x['name'].removesuffix('.pat').upper() for x in inventory)+'\n',encoding='utf-8',newline='\n')

md=['# 48 штриховок для чертежей и документации','', 'Визуальный каталог с описаниями: [catalog.html](catalog.html). Все иллюстрации встроены; подключение к сети для просмотра не требуется. Поиск и фильтр работают локально. Печать — кнопкой в каталоге.','', 'Шесть обзорных листов: `plate_01` … `plate_06` в SVG и PNG. В папке `samples` — 48 отдельных SVG. `catalog.json` содержит описания и ссылки на конкретные исходные файлы; `inventory_127.txt` — полный перечень 127 имён из проверенной папки QCAD.','', 'Это не полный мировой реестр. ISO/DIN регулируют оформление разрезов и линий; здесь приведены CAD-узоры, а не аттестованные нормативные знаки каждого материала. Назначение закрепляйте в легенде и спецификации. Масштаб образцов условный.','', 'Воспроизведение и лицензии: [SOURCES.md](SOURCES.md). Для передачи агенту: [hatching-catalog-handoff.md](../../docs/hatching-catalog-handoff.md).','', '## Список с иллюстрациями','']
for i,m in enumerate(metadata):
    if i%8==0:md+=['## '+groups[i//8],'']
    md += [f'### {m["code"]} · {m["name"]} — {m["title"]}','',f'![{m["title"]}](samples/{m["code"]}_{rows[i][0]}.svg)','',m['description']+' '+m['usage'],'',f'[Исходное CAD-определение]({m["source"]})','']
md += ['## Источники и пределы','', 'Геометрия: [QCAD metric patterns](https://github.com/qcad/qcad/tree/master/patterns/metric). Проверка перечня и исходных определений выполнена 26.09.2026. Исходные PAT-определения включены в `hatch_sources.json` вместе со ссылками и контрольными SHA. Условия, происхождение и команды — в [SOURCES.md](SOURCES.md).','', 'Лицензионное уведомление QCAD: [LICENSE.txt](https://github.com/qcad/qcad/blob/master/LICENSE.txt), [GPL-3.0](https://github.com/qcad/qcad/blob/master/gpl-3.0.txt). Автор исходных определений: проект QCAD / соответствующие правообладатели.','', 'Нормативные ориентиры: ISO 128-2 / DIN EN ISO 128-2; ISO 128-3 / DIN EN ISO 128-3; отдельно ГОСТ 2.306-68 для ЕСКД. Полные тексты ISO/DIN недоступны в этой сессии. Оригиналы ANSI/JIS не проверялись; префиксы ANSI/JIS в этом справочнике — имена CAD-файлов.','', 'Нет общего правила, назначающего титану, меди, стеклу или изоляционной ленте уникальный международный узор. Соседние детали различают направлением и шагом; материал задаётся также текстом. Карта, разрез здания, машиностроительный чертёж и пояснительный рисунок требуют разных легенд.']
(OUT/'README.md').write_text('\n'.join(md),encoding='utf-8',newline='\n')
print('Built 48 SVG samples, 6 plates, searchable catalog, metadata and inventory of 127 names.')
