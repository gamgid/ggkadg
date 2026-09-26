'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Headphones, Plus, QrCode, Search, Settings, ShieldCheck, Upload, X } from 'lucide-react';
import { storageService } from '../src/services/storageService';
import { createCardFlip } from '../src/animation/cardFlip.mjs';

type Tab = 'id' | 'services' | 'jobs' | 'menu';
type Panel = 'settings' | 'faq' | 'support' | 'notifications' | 'profile' | null;
type JobDirection = 'drones' | 'contract' | 'it' | 'new' | 'for-you' | 'all';
type Profile = { id:string; firstName:string; lastName:string; middleName:string; birthDate:string; phone:string; email:string; city:string; status:string; updatedAt:string; photo?:string };
type Stored = { profile:Profile; qr:string; animations:boolean; notices:string[] };

const baseProfile:Profile={id:'DEMO-57392817',firstName:'Тестовий',lastName:'Демо',middleName:'Профіль',birthDate:'2000-01-01',phone:'+380 00 000 00 00',email:'demo@example.com',city:'Київ',status:'Демонстраційний статус',updatedAt:'09.09.2026'};
const services=[
  'Виправити дані онлайн',
  'Електронна черга в ТЦК та СП',
  'Запит на відстрочку',
  'Направлення на ВЛК',
  'Розширені дані з реєстру',
  'Стати на облік',
  'Уточнити контактні дані',
  'Штрафи',
];
const questions=['Електронна демо-черга','Дані профілю','Категорії обліку','Відстрочка','Загальні питання','Направлення','Можливості','Виправити дані онлайн'];
const messages=['Дані профілю збережено','Новий демонстраційний QR створено','Це тестова версія сервісу'];
const makeQr=()=>`DEMO-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0').slice(0,8)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0').slice(0,8)}`;
const uaDate=(value:string)=>value.split('-').reverse().join('.');
const qrVersion=32;
const qrExpiryDate=()=>{const date=new Date();date.setMonth(date.getMonth()+1);const months=['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`};

export default function HomePage(){
  const [ready,setReady]=useState(false),[tab,setTab]=useState<Tab>('id'),[panel,setPanel]=useState<Panel>(null),[jobsContractsOpen,setJobsContractsOpen]=useState(true),[qrOpen,setQrOpen]=useState(false),[seconds,setSeconds]=useState(180),[profile,setProfile]=useState(baseProfile),[qr,setQr]=useState('DEMO-00000000-00000000'),[animations,setAnimations]=useState(true),[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{const saved=storageService.load<Stored>();if(saved){setProfile(saved.profile||baseProfile);setQr(saved.qr||makeQr());setAnimations(saved.animations!==false)}else{setProfile({...baseProfile,id:`DEMO-${String(crypto.getRandomValues(new Uint32Array(1))[0]).slice(0,8)}`});setQr(makeQr())}navigator.serviceWorker?.register(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/sw.js`, {scope: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}).catch(()=>{});const id=setTimeout(()=>setReady(true),850);return()=>clearTimeout(id)},[]);
  useEffect(()=>{if(ready)storageService.save<Stored>({profile,qr,animations,notices:messages})},[profile,qr,animations,ready]);
  useEffect(()=>{const id=setInterval(()=>setSeconds(s=>{if(s<=1){setQr(makeQr());return 180}return s-1}),1000);return()=>clearInterval(id)},[]);
  const regenerate=()=>{setQr(makeQr());setSeconds(180);setNotice('Новий тестовий QR створено')};
  const copyDeviceNumber=async()=>{try{await navigator.clipboard.writeText(profile.id);setNotice('Номер демо-пристрою скопійовано')}catch{setNotice('Не вдалося скопіювати номер пристрою')}};
  if(!ready)return <main className="video-app splash-v"><div className="splash-mark">D</div><h1>Облік DEMO</h1><p>Демонстраційна пародія</p></main>;
  return <main className={`video-app ${animations?'':'no-motion'} ${panel?'panel-open':''}`}>
    <div className="video-watermark">ДЕМО / ПАРОДІЯ — НЕ Є СПРАВЖНІМ ДОКУМЕНТОМ</div>
    {panel?<SubPanel panel={panel} close={()=>setPanel(null)} profile={profile} setProfile={setProfile} animations={animations} setAnimations={setAnimations} openQr={()=>setQrOpen(true)}/>:<>
      <section className="video-page">
        {tab==='id'&&<IdScreen profile={profile} qr={qr} seconds={seconds} openMessages={()=>setPanel('notifications')}/>} 
        {tab==='services'&&<ServicesScreen setNotice={setNotice}/>} 
        {tab==='jobs'&&<JobsScreen contractsOpen={jobsContractsOpen} closeContracts={()=>setJobsContractsOpen(false)} setNotice={setNotice}/>} 
        {tab==='menu'&&<MenuScreen open={setPanel} openQr={()=>setQrOpen(true)} copyDeviceNumber={copyDeviceNumber} notify={setNotice}/>} 
      </section>
      {!(tab==='jobs'&&jobsContractsOpen)&&<BottomNav tab={tab} setTab={setTab}/>} 
    </>}
    {qrOpen&&<QrSheet value={qr} seconds={seconds} regenerate={regenerate} close={()=>setQrOpen(false)}/>} 
    {notice&&<div className="toast" onAnimationEnd={()=>setNotice(null)}>{notice}</div>}
  </main>;
}

function IdScreen({profile,qr,openMessages}:{profile:Profile;qr:string;seconds:number;openMessages:()=>void}){
  const [flipped,setFlipped]=useState(false);
  const [isTurning,setIsTurning]=useState(false);
  const cardRef=useRef<HTMLButtonElement|null>(null);
  const flipRef=useRef<ReturnType<typeof createCardFlip>|null>(null);
  const expiry=qrExpiryDate(),status='Демо-статус  •  Оновлено о 18:42';

  useEffect(()=>{
    if(!cardRef.current)return;
    const controller=createCardFlip(cardRef.current,{
      onChange:state=>{setFlipped(state.flipped);setIsTurning(state.busy)},
    });
    flipRef.current=controller;
    return ()=>{controller.dispose();flipRef.current=null};
  },[]);

  return <div className="id-screen"><header className="screen-tools"><span/><button onClick={openMessages}>Сповіщення <Bell/></button></header><div className="flip-shell"><button ref={cardRef} className="id-card flip-card" onClick={()=>flipRef.current?.flip()} aria-disabled={isTurning} aria-busy={isTurning} aria-label={flipped?'Повернутися до демо-документа':'Показати тестовий QR'}><section className="id-face id-front"><div className="id-head"><h1>Демо ID</h1><span className="shield">D</span></div><label>Дата народження:<b>{uaDate(profile.birthDate)}</b></label><div className="card-space"><strong>ДЕМО — НЕ Є ДОКУМЕНТОМ</strong></div><div className="status-strip"><div className="status-track"><span>{status}</span><span aria-hidden="true">{status}</span></div></div><div className="id-person"><div><small>Демонстраційний профіль</small><h2><span className="profile-surname">{profile.lastName}</span><br/>{profile.firstName}<br/>{profile.middleName}</h2></div><span className="orange-circle" aria-hidden="true"><Plus strokeWidth={3.5}/></span></div><span className="flip-shade" aria-hidden="true"/></section><section className="id-face id-back"><p className="back-warning">ТЕСТОВИЙ QR — НЕ ДЛЯ ПЕРЕВІРКИ</p><h2>QR дійсний до {expiry}</h2><div className="flip-qr"><QRCodeSVG value={qr} size={320} minVersion={qrVersion} level="M" boostLevel={false}/></div><small className="back-legal">НЕ ПІДТВЕРДЖУЄ ОСОБУ · НЕ МАЄ ЮРИДИЧНОЇ СИЛИ</small><span className="flip-shade" aria-hidden="true"/></section></button></div></div>}

function ServicesScreen({setNotice}:{setNotice:(v:string)=>void}){return <div className="plain-screen services-screen"><h1>Сервіси</h1><div className="bare-list">{services.map(x=><button key={x} onClick={()=>setNotice(`${x}: лише демонстрація, без надсилання запиту`)}><span>{x}</span><ChevronRight aria-hidden="true"/></button>)}</div></div>}

const jobDirections:{id:JobDirection;label:string}[]=[
  {id:'drones',label:'Лінія дронів'},
  {id:'contract',label:'Контракт 18–24'},
  {id:'it',label:'IT-вертикаль'},
  {id:'new',label:'Нові контракти'},
  {id:'for-you',label:'Для вас'},
  {id:'all',label:'Всі вакансії'},
];
const jobAsset=(name:string)=>`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/jobs/${name}`;
const demoVacancies=[
  {role:'Механік БПЛА',unit:'106 окрема бригада територіальної оборони',badge:'vacancy-sun.png'},
  {role:'Слюсар-автомеханік',unit:'81 окремий батальйон зв’язку',badge:'vacancy-tools.png'},
  {role:'Бойовий медик',unit:'97 окремий батальйон підтримки',badge:'vacancy-trident.png'},
  {role:'Зв’язківець',unit:'97 окремий батальйон підтримки',badge:'vacancy-trident.png'},
  {role:'Штаб-сержант 3 категорії групи цифрового розвитку',unit:'97 окремий батальйон підтримки',badge:'vacancy-trident.png'},
  {role:'Штаб-сержант відділення комунікацій',unit:'50 окрема артилерійська бригада',badge:'vacancy-red.png'},
  {role:'Перекладач з іспанської мови',unit:'Центр рекрутингу Десантно-штурмових військ',badge:'vacancy-dshv.png'},
  {role:'Журналіст',unit:'Центр рекрутингу Десантно-штурмових військ',badge:'vacancy-dshv.png'},
  {role:'Motion-дизайнер',unit:'Центр рекрутингу Десантно-штурмових військ',badge:'vacancy-dshv.png'},
  {role:'Начальник групи соціального супроводу',unit:'55 окрема механізована бригада',badge:'vacancy-trident.png'},
  {role:'Офіцер Регіональної мобільної групи',unit:'Центр рекрутингу Десантно-штурмових військ',badge:'vacancy-dshv.png'},
  {role:'Начальник Регіональної мобільної групи',unit:'Центр рекрутингу Десантно-штурмових військ',badge:'vacancy-dshv.png'},
  {role:'Офіцер секції ЦВС',unit:'55 окрема механізована бригада',badge:'vacancy-trident.png'},
  {role:'Оператор БПЛА',unit:'59 окрема штурмова бригада безпілотних систем імені Якова Гандзюка',badge:'vacancy-dark.png'},
  {role:'Оператор НРК',unit:'59 окрема штурмова бригада безпілотних систем імені Якова Гандзюка',badge:'vacancy-dark.png'},
] as const;
const interests=['Авіація','Артилерія','БПЛА','Броньована техніка','Зв’язок','Зеніт/ППО','IT','Командування','Кухня','Логістика','Медицина','Медіа','Морально-психологічне забезпечення','Навчання','Піхота','РЕБ/РЕР','Ремонт','Розвідка','Сили підтримки','Снайпінг','Танкові війська','Транспорт','Фінанси','Юриспруденція'];

function JobsScreen({contractsOpen,closeContracts,setNotice}:{contractsOpen:boolean;closeContracts:()=>void;setNotice:(value:string)=>void}){
  const [direction,setDirection]=useState<JobDirection>('new');
  const directionsRef=useRef<HTMLElement|null>(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [interestsSelected,setInterestsSelected]=useState<string[]>([]);
  const [selectedVacancies,setSelectedVacancies]=useState<number[]>([]);
  const [expanded,setExpanded]=useState<number|null>(null);
  const chooseDirection=(next:JobDirection)=>setDirection(next);
  const returnToDirections=()=>{setDirection('new');closeContracts()};
  const toggleVacancy=(index:number)=>setSelectedVacancies(current=>current.includes(index)?current.filter(value=>value!==index):[...current,index].slice(0,10));
  useEffect(()=>{
    if(contractsOpen)return;
    const frame=requestAnimationFrame(()=>directionsRef.current?.querySelector<HTMLButtonElement>('button.active')?.scrollIntoView({block:'nearest',inline:'center'}));
    return ()=>cancelAnimationFrame(frame);
  },[contractsOpen,direction]);
  if(contractsOpen)return <section className="contracts-screen" aria-label="Нові контракти">
    <button className="contracts-back" onClick={returnToDirections} aria-label="Повернутися до вакансій"><ChevronLeft/></button>
    <header><h1>Нові контракти</h1><p>Ознайомся з умовами кожного виду служби та обирай вакансію, яка підходить саме тобі</p></header>
    <div className="contract-types">
      {['Новий піхотно-штурмовий контракт','Новий бойовий контракт','Новий базовий контракт','Як подати заявку?'].map((label,index)=><div className={`contract-type ${expanded===index?'expanded':''}`} key={label}><button onClick={()=>setExpanded(expanded===index?null:index)}><span>{index<3&&<img className="contract-mark" src={jobAsset('contract-mark.png')} alt=""/>}{label}</span>{expanded===index?<ChevronUp/>:<ChevronDown/>}</button>{expanded===index&&<p>{index===3?'Обери до 10 вакансій і натисни кнопку відгуку. У демо-версії дані нікуди не надсилаються.':'Інформація цього розділу відтворена для демонстрації інтерфейсу.'}</p>}</div>)}
    </div>
    <div className="vacancy-count"><span>Вакансії</span><b>{selectedVacancies.length}/10</b></div>
    <div className="vacancy-list">{demoVacancies.map((vacancy,index)=><label className="vacancy-row" key={vacancy.role}><input type="checkbox" checked={selectedVacancies.includes(index)} onChange={()=>toggleVacancy(index)}/><img className="vacancy-shield" src={jobAsset(vacancy.badge)} alt=""/><span><b>{vacancy.role}</b><small>{vacancy.unit}</small></span></label>)}</div>
    <div className="contracts-action"><button disabled={!selectedVacancies.length} onClick={()=>setNotice(`Обрано тестових вакансій: ${selectedVacancies.length}. Дані нікуди не надіслано`)}>Відгукнутись на вакансії</button></div>
  </section>;

  const visibleVacancies=demoVacancies.filter(vacancy=>`${vacancy.role} ${vacancy.unit}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="jobs-screen">
    <header className="jobs-header"><h1>Вакансії в<br/>Силах оборони<br/>України</h1><button onClick={()=>setSearchOpen(value=>!value)} aria-label="Пошук вакансій"><Search/></button></header>
    {searchOpen&&<div className="jobs-search"><Search/><input autoFocus value={search} onChange={event=>setSearch(event.target.value)} placeholder="Пошук у демо-вакансіях"/><button onClick={()=>{setSearch('');setSearchOpen(false)}} aria-label="Закрити пошук"><X/></button></div>}
    <nav ref={directionsRef} className="job-tabs" aria-label="Напрямки вакансій">{jobDirections.map(item=><button key={item.id} className={direction===item.id?'active':''} onClick={()=>chooseDirection(item.id)}>{item.id==='new'&&<i/>}{item.label}</button>)}</nav>
    {searchOpen&&search.trim()?<section className="job-card search-results"><h2>Результати</h2>{visibleVacancies.length?<div className="simple-vacancies">{visibleVacancies.map(vacancy=><button key={vacancy.role} onClick={()=>setNotice(`${vacancy.role}: демонстраційна вакансія`)}><b>{vacancy.role}</b><small>{vacancy.unit}</small><ChevronRight/></button>)}</div>:<p>Нічого не знайдено</p>}</section>:direction==='for-you'?<ForYouCard selected={interestsSelected} setSelected={setInterestsSelected} setNotice={setNotice}/>:direction==='all'?<AllVacanciesCard setNotice={setNotice}/>:<UnitsCard direction={direction as 'drones'|'contract'|'it'|'new'} setNotice={setNotice}/>} 
  </div>;
}

function UnitsCard({direction,setNotice}:{direction:'drones'|'contract'|'it'|'new';setNotice:(value:string)=>void}){const image=direction==='contract'?'unit-grid-contract.png':direction==='it'?'it-trident.png':'unit-grid-new.png';return <section className={`job-card units-card direction-${direction}`}><h2>На вас чекають</h2><button className="reference-unit-art" onClick={()=>setNotice('Емблеми показані лише як частина навчального макета')}><img src={jobAsset(image)} alt="Добірка емблем напрямку"/></button><button className="orange-button" onClick={()=>setNotice('Перебіг подій змінено лише у демо-версії')}><span>Змінити перебіг подій</span></button></section>}

function ForYouCard({selected,setSelected,setNotice}:{selected:string[];setSelected:(value:string[])=>void;setNotice:(value:string)=>void}){const toggle=(value:string)=>setSelected(selected.includes(value)?selected.filter(item=>item!==value):[...selected,value]);return <section className="job-card interests-card"><h2>Що вас цікавить?</h2><div>{interests.map(value=><button key={value} className={selected.includes(value)?'selected':''} onClick={()=>toggle(value)}>{value}</button>)}</div><button className="answer-button" disabled={!selected.length} onClick={()=>setNotice(`Збережено тестових інтересів: ${selected.length}`)}>Відповісти</button></section>}

function AllVacanciesCard({setNotice}:{setNotice:(value:string)=>void}){return <section className="job-card all-vacancies"><h2>Всі вакансії</h2><div className="simple-vacancies">{demoVacancies.slice(0,6).map(vacancy=><button key={vacancy.role} onClick={()=>setNotice(`${vacancy.role}: демонстраційна вакансія`)}><b>{vacancy.role}</b><small>{vacancy.unit}</small><ChevronRight/></button>)}</div></section>}

type MenuIcon = 'sessions' | 'settings' | 'faq' | 'support' | 'device' | 'scan';

function MenuGlyph({name}:{name:MenuIcon}){
  if(name==='settings')return <Settings className="menu-glyph" strokeWidth={2.45}/>;
  if(name==='sessions')return <svg className="menu-glyph" viewBox="0 0 28 28" aria-hidden="true"><rect x="6.5" y="2.5" width="15" height="23" rx="3"/><path d="M11 5.8h6M12.3 22.2h3.4"/></svg>;
  if(name==='faq')return <svg className="menu-glyph" viewBox="0 0 28 28" aria-hidden="true"><path d="M7 3.5h10.2L21 7.3v17.2H7z"/><path d="M17.2 3.8v4h3.5M11.2 11.2a3 3 0 1 1 4.2 2.7c-1 .5-1.4 1.1-1.4 2.1M14 20h.01"/></svg>;
  if(name==='support')return <svg className="menu-glyph" viewBox="0 0 28 28" aria-hidden="true"><rect x="3.5" y="5" width="21" height="18" rx="4"/><path d="m7.5 10 5 4-5 4M20.5 10l-5 4 5 4"/></svg>;
  if(name==='device')return <svg className="menu-glyph" viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="5" width="13" height="19" rx="2.5"/><rect x="11" y="3" width="13" height="19" rx="2.5"/><path d="M15.5 18.5h4"/></svg>;
  return <svg className="menu-glyph" viewBox="0 0 28 28" aria-hidden="true"><path d="M3 10V4h6M19 4h6v6M25 18v6h-6M9 24H3v-6"/><path d="M9 9h3v3H9zM16 9h3v3h-3zM9 16h3v3H9zM16 16h3v3h-3z"/></svg>;
}

function MenuScreen({open,openQr,copyDeviceNumber,notify}:{open:(p:Panel)=>void;openQr:()=>void;copyDeviceNumber:()=>void;notify:(value:string)=>void}){return <div className="menu-screen"><h1>Меню</h1><small>Версія 2.4.1</small><div className="menu-groups"><div><MenuRow icon="sessions" title="Активні сесії" chevron onClick={()=>notify('У демо-версії активна лише ця локальна сесія')}/><MenuRow icon="settings" title="Налаштування" chevron onClick={()=>open('settings')}/></div><div><MenuRow icon="faq" title="Питання та відповіді" chevron onClick={()=>open('faq')}/><MenuRow icon="support" title="Служба підтримки" chevron onClick={()=>open('support')}/><MenuRow icon="device" title="Копіювати номер пристрою" onClick={copyDeviceNumber}/></div><div className="menu-single"><MenuRow icon="scan" title="Сканувати документ" onClick={openQr}/></div></div><button className="logout" onClick={()=>notify('Вихід недоступний у локальній демо-версії')}>Вийти</button><button className="privacy" onClick={()=>notify('Демо-дані зберігаються лише локально на цьому пристрої')}>Повідомлення про обробку персональних даних</button></div>}

function MenuRow({icon,title,chevron=false,onClick}:{icon:MenuIcon;title:string;chevron?:boolean;onClick?:()=>void}){return <button className="menu-row" onClick={onClick}><MenuGlyph name={icon}/><span>{title}</span>{chevron&&<ChevronRight className="menu-chevron" strokeWidth={3.2}/>}</button>}

function Row({icon:Icon,title,onClick}:{icon:typeof Settings;title:string;onClick?:()=>void}){return <button className="menu-row" onClick={onClick}><Icon/><span>{title}</span>{onClick&&<ChevronRight/>}</button>}

function NavGlyph({id,active}:{id:Tab;active:boolean}){
  const stateClass=active?' nav-glyph-active':'';
  if(id==='id')return <svg className={`nav-glyph-document${stateClass}`} viewBox="0 0 20 24" aria-hidden="true"><rect className="nav-document-body" x="1" y="1" width="18" height="22" rx=".5"/><path className="nav-document-lines" d="M4 15.5h12M4 19.5h12"/></svg>;
  if(id==='services')return <svg className={`nav-glyph-services${stateClass}`} viewBox="0 0 22 24" aria-hidden="true"><rect x="1" y="1" width="8" height="9" rx=".5"/><rect x="13" y="1" width="8" height="9" rx=".5"/><rect x="1" y="14" width="8" height="9" rx=".5"/><rect x="13" y="14" width="8" height="9" rx=".5"/></svg>;
  if(id==='jobs')return <svg className={`nav-glyph-jobs${stateClass}`} viewBox="0 0 20 24" aria-hidden="true"><rect className="nav-job-body" x="1" y="1" width="18" height="22" rx=".5"/><rect className="nav-job-diamond" x="6" y="8" width="8" height="8" rx=".5" transform="rotate(45 10 12)"/></svg>;
  return <svg className={`nav-glyph-menu${stateClass}`} viewBox="0 0 20 17" aria-hidden="true"><rect x="0" y="0" width="20" height="3"/><rect x="0" y="7" width="20" height="3"/><rect x="0" y="14" width="20" height="3"/></svg>;
}

function BottomNav({tab,setTab}:{tab:Tab;setTab:(t:Tab)=>void}){const tabs=[['id','Резерв ID'],['services','Сервіси'],['jobs','Вакансії'],['menu','Меню']] as const;return <nav className="video-nav" aria-label="Основна навігація">{tabs.map(([id,label])=>{const active=tab===id;return <button key={id} className={active?'active':''} onClick={()=>setTab(id)} aria-current={active?'page':undefined}><span className="nav-icon"><NavGlyph id={id} active={active}/></span><span className="nav-label">{label}</span></button>})}</nav>}

function SubPanel({panel,close,profile,setProfile,animations,setAnimations,openQr}:{panel:Exclude<Panel,null>;close:()=>void;profile:Profile;setProfile:(p:Profile)=>void;animations:boolean;setAnimations:(v:boolean)=>void;openQr:()=>void}){if(panel==='profile')return <ProfileEditor profile={profile} save={p=>{setProfile({...p,updatedAt:new Date().toLocaleDateString('uk-UA')});close()}} close={close}/>;const titles={settings:'Налаштування',faq:'Питання та відповіді',support:'Служба підтримки',notifications:'Повідомлення'};return <section className="sub-screen"><button className="back" onClick={close}><ChevronLeft/></button><h1>{titles[panel]}</h1>{panel==='settings'&&<div className="settings-card"><Row icon={ShieldCheck} title="Змінити код для входу"/><Toggle title="Використовувати Face ID" value/><Toggle title="Отримувати демо-сповіщення" value={false}/><Toggle title="Перевіряти QR офлайн" value={false}/><Toggle title="Анімації" value={animations} change={()=>setAnimations(!animations)}/><button className="menu-row" onClick={openQr}><QrCode/><span>Згенерувати новий QR</span><ChevronRight/></button></div>}{panel==='faq'&&<div className="white-list">{questions.map(q=><button key={q}>{q}<ChevronRight/></button>)}</div>}{panel==='support'&&<><p>Маєте додаткові питання про демонстраційний застосунок? Напишіть нам — без передавання персональних даних.</p><div className="support-card"><Headphones/><b>Демо-чат підтримки</b></div><button className="copy-device"><Copy/> Копіювати номер демо-пристрою</button></>}{panel==='notifications'&&<div className="white-list notices">{messages.map((m,i)=><button key={m}><Bell/><span><b>{m}</b><small>{i===0?'Сьогодні, 12:40':'09.09.2026, 09:00'}</small></span></button>)}</div>}</section>}

function Toggle({title,value,change}:{title:string;value:boolean;change?:()=>void}){return <button className="menu-row" onClick={change}><span>{title}</span><i className={`toggle ${value?'on':''}`}/></button>}

function ProfileEditor({profile,save,close}:{profile:Profile;save:(p:Profile)=>void;close:()=>void}){const[p,setP]=useState(profile),set=(k:keyof Profile,v:string)=>setP({...p,[k]:v}),photo=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>set('photo',String(reader.result));reader.readAsDataURL(file)};return <form className="sub-screen editor" onSubmit={e=>{e.preventDefault();save(p)}}><button type="button" className="back" onClick={close}><ChevronLeft/></button><h1>Демо-профіль</h1><label className="photo-picker">{p.photo?<img src={p.photo} alt="Фото профілю"/>:<span><Upload/></span>}<b>Змінити фото</b><input type="file" accept="image/*" onChange={e=>photo(e.target.files?.[0])}/></label>{([['lastName','Прізвище'],['firstName','Ім’я'],['middleName','По батькові'],['birthDate','Дата народження'],['phone','Телефон'],['email','Email'],['city','Місто']] as const).map(([key,label])=><label className="edit-field" key={key}><span>{label}</span><input type={key==='birthDate'?'date':'text'} value={p[key]||''} onChange={e=>set(key,e.target.value)}/></label>)}<label className="edit-field"><span>Демонстраційний статус</span><select value={p.status} onChange={e=>set('status',e.target.value)}><option>Демонстраційний статус</option><option>Дані уточнено</option><option>Очікує оновлення</option></select></label><button className="orange-button">Зберегти локально</button></form>}

function QrSheet({value,seconds,regenerate,close}:{value:string;seconds:number;regenerate:()=>void;close:()=>void}){const timer=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;return <div className="sheet-back" onClick={close}><section className="qr-sheet" onClick={e=>e.stopPropagation()}><button className="sheet-close" onClick={close}><X/></button><p>ТЕСТОВИЙ QR — НЕ ДЛЯ ПЕРЕВІРКИ</p><h1>Демо-код</h1><div className="qr-box"><QRCodeSVG value={value} size={218} minVersion={qrVersion} level="M" boostLevel={false}/></div><code>{value}</code><small>QR оновиться через {timer}</small><strong>ТЕСТОВИЙ QR<br/>НЕ ПІДТВЕРДЖУЄ ОСОБУ<br/>НЕ МАЄ ЮРИДИЧНОЇ СИЛИ</strong><button className="orange-button" onClick={regenerate}>Оновити QR</button></section></div>}
