'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Bell, BriefcaseBusiness, ChevronLeft, ChevronRight, CircleHelp, Copy, FileText, Grid2X2, Headphones, LogOut, Menu, Plus, QrCode, Search, Settings, ShieldCheck, Smartphone, Upload, X } from 'lucide-react';
import { storageService } from '../src/services/storageService';
import { createCardFlip } from '../src/animation/cardFlip.mjs';

type Tab = 'id' | 'services' | 'jobs' | 'menu';
type Panel = 'settings' | 'faq' | 'support' | 'notifications' | 'profile' | null;
type Profile = { id:string; firstName:string; lastName:string; middleName:string; birthDate:string; phone:string; email:string; city:string; status:string; updatedAt:string; photo?:string };
type Stored = { profile:Profile; qr:string; animations:boolean; notices:string[] };

const baseProfile:Profile={id:'DEMO-57392817',firstName:'Тестовий',lastName:'Демо',middleName:'Профіль',birthDate:'2000-01-01',phone:'+380 00 000 00 00',email:'demo@example.com',city:'Київ',status:'Демонстраційний статус',updatedAt:'09.09.2026'};
const services=['Виправити демо-дані онлайн','Електронна демо-черга','Запит на тестове оновлення','Навчальний напрямок','Розширені демо-дані','Створити локальний профіль','Уточнити контактні дані'];
const questions=['Електронна демо-черга','Дані профілю','Категорії обліку','Відстрочка','Загальні питання','Направлення','Можливості','Виправити дані онлайн'];
const messages=['Дані профілю збережено','Новий демонстраційний QR створено','Це тестова версія сервісу'];
const makeQr=()=>`DEMO-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0').slice(0,8)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0').slice(0,8)}`;
const uaDate=(value:string)=>value.split('-').reverse().join('.');
const qrVersion=32;
const qrExpiryDate=()=>{const date=new Date();date.setMonth(date.getMonth()+1);const months=['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`};

export default function HomePage(){
  const [ready,setReady]=useState(false),[tab,setTab]=useState<Tab>('id'),[panel,setPanel]=useState<Panel>(null),[jobsStarted,setJobsStarted]=useState(false),[qrOpen,setQrOpen]=useState(false),[seconds,setSeconds]=useState(180),[profile,setProfile]=useState(baseProfile),[qr,setQr]=useState('DEMO-00000000-00000000'),[animations,setAnimations]=useState(true),[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{const saved=storageService.load<Stored>();if(saved){setProfile(saved.profile||baseProfile);setQr(saved.qr||makeQr());setAnimations(saved.animations!==false)}else{setProfile({...baseProfile,id:`DEMO-${String(crypto.getRandomValues(new Uint32Array(1))[0]).slice(0,8)}`});setQr(makeQr())}navigator.serviceWorker?.register(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/sw.js`, {scope: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}).catch(()=>{});const id=setTimeout(()=>setReady(true),850);return()=>clearTimeout(id)},[]);
  useEffect(()=>{if(ready)storageService.save<Stored>({profile,qr,animations,notices:messages})},[profile,qr,animations,ready]);
  useEffect(()=>{const id=setInterval(()=>setSeconds(s=>{if(s<=1){setQr(makeQr());return 180}return s-1}),1000);return()=>clearInterval(id)},[]);
  const regenerate=()=>{setQr(makeQr());setSeconds(180);setNotice('Новий тестовий QR створено')};
  if(!ready)return <main className="video-app splash-v"><div className="splash-mark">D</div><h1>Облік DEMO</h1><p>Демонстраційна пародія</p></main>;
  return <main className={`video-app ${animations?'':'no-motion'} ${panel?'panel-open':''}`}>
    <div className="video-watermark">ДЕМО / ПАРОДІЯ — НЕ Є СПРАВЖНІМ ДОКУМЕНТОМ</div>
    {panel?<SubPanel panel={panel} close={()=>setPanel(null)} profile={profile} setProfile={setProfile} animations={animations} setAnimations={setAnimations} openQr={()=>setQrOpen(true)}/>:<>
      <section className="video-page">
        {tab==='id'&&<IdScreen profile={profile} qr={qr} seconds={seconds} openMessages={()=>setPanel('notifications')}/>} 
        {tab==='services'&&<ServicesScreen setNotice={setNotice}/>} 
        {tab==='jobs'&&<JobsScreen started={jobsStarted} start={()=>setJobsStarted(true)}/>} 
        {tab==='menu'&&<MenuScreen open={setPanel} openQr={()=>setQrOpen(true)}/>} 
      </section>
      <BottomNav tab={tab} setTab={setTab}/>
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

function ServicesScreen({setNotice}:{setNotice:(v:string)=>void}){return <div className="plain-screen services-screen"><h1>Сервіси</h1><div className="bare-list">{services.map(x=><button key={x} onClick={()=>setNotice(`${x}: демонстраційний розділ`)}><span>{x}</span><ChevronRight/></button>)}</div></div>}

function JobsScreen({started,start}:{started:boolean;start:()=>void}){if(!started)return <div className="intro-screen"><button className="help"><CircleHelp/></button><div><h1>Можливості</h1><p>Тут знаходяться демонстраційні пропозиції для знайомства з інтерфейсом. Вони не є справжніми вакансіями.</p><p>Виберіть напрямок і перегляньте тестові картки без надсилання заявок.</p></div><label className="check"><input type="checkbox"/> Більше не показувати</label><button className="orange-button" onClick={start}>Почати</button></div>;return <div className="jobs-screen"><header><h1>Демо-можливості<br/>в Україні</h1><button><Search/></button></header><div className="job-tabs"><b>Лінія демо</b><span>Контракт 18–24</span><span>Для вас</span></div><section className="job-card"><h2>На вас чекають</h2><div className="unit-grid">{['A1','B2','C3','D4','E5','F6','G7','+24'].map((x,i)=><span key={x} style={{background:['#222','#314d7b','#c99616','#7a3b24','#68774d'][i%5]}}>{x}</span>)}</div><button className="orange-button">Змінити демо-напрямок</button></section></div>}

function MenuScreen({open,openQr}:{open:(p:Panel)=>void;openQr:()=>void}){return <div className="menu-screen"><h1>Меню</h1><small>Версія DEMO 2.4.1</small><div className="menu-groups"><div><Row icon={Smartphone} title="Активні демо-сесії"/><Row icon={Settings} title="Налаштування" onClick={()=>open('settings')}/></div><div><Row icon={CircleHelp} title="Питання та відповіді" onClick={()=>open('faq')}/><Row icon={Headphones} title="Служба підтримки" onClick={()=>open('support')}/><Row icon={Copy} title="Копіювати демо-номер"/></div><div><Row icon={Bell} title="Повідомлення" onClick={()=>open('notifications')}/><Row icon={Upload} title="Редагувати демо-профіль" onClick={()=>open('profile')}/><Row icon={QrCode} title="Сканувати демо-документ" onClick={openQr}/></div></div><button className="logout"><LogOut/> Вийти</button><p className="privacy">Дані зберігаються лише на цьому пристрої</p></div>}

function Row({icon:Icon,title,onClick}:{icon:typeof Settings;title:string;onClick?:()=>void}){return <button className="menu-row" onClick={onClick}><Icon/><span>{title}</span>{onClick&&<ChevronRight/>}</button>}

function BottomNav({tab,setTab}:{tab:Tab;setTab:(t:Tab)=>void}){const tabs=[['id',FileText,'Демо ID'],['services',Grid2X2,'Сервіси'],['jobs',BriefcaseBusiness,'Можливості'],['menu',Menu,'Меню']] as const;return <nav className="video-nav">{tabs.map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon/><span>{label}</span></button>)}</nav>}

function SubPanel({panel,close,profile,setProfile,animations,setAnimations,openQr}:{panel:Exclude<Panel,null>;close:()=>void;profile:Profile;setProfile:(p:Profile)=>void;animations:boolean;setAnimations:(v:boolean)=>void;openQr:()=>void}){if(panel==='profile')return <ProfileEditor profile={profile} save={p=>{setProfile({...p,updatedAt:new Date().toLocaleDateString('uk-UA')});close()}} close={close}/>;const titles={settings:'Налаштування',faq:'Питання та відповіді',support:'Служба підтримки',notifications:'Повідомлення'};return <section className="sub-screen"><button className="back" onClick={close}><ChevronLeft/></button><h1>{titles[panel]}</h1>{panel==='settings'&&<div className="settings-card"><Row icon={ShieldCheck} title="Змінити код для входу"/><Toggle title="Використовувати Face ID" value/><Toggle title="Отримувати демо-сповіщення" value={false}/><Toggle title="Перевіряти QR офлайн" value={false}/><Toggle title="Анімації" value={animations} change={()=>setAnimations(!animations)}/><button className="menu-row" onClick={openQr}><QrCode/><span>Згенерувати новий QR</span><ChevronRight/></button></div>}{panel==='faq'&&<div className="white-list">{questions.map(q=><button key={q}>{q}<ChevronRight/></button>)}</div>}{panel==='support'&&<><p>Маєте додаткові питання про демонстраційний застосунок? Напишіть нам — без передавання персональних даних.</p><div className="support-card"><Headphones/><b>Демо-чат підтримки</b></div><button className="copy-device"><Copy/> Копіювати номер демо-пристрою</button></>}{panel==='notifications'&&<div className="white-list notices">{messages.map((m,i)=><button key={m}><Bell/><span><b>{m}</b><small>{i===0?'Сьогодні, 12:40':'09.09.2026, 09:00'}</small></span></button>)}</div>}</section>}

function Toggle({title,value,change}:{title:string;value:boolean;change?:()=>void}){return <button className="menu-row" onClick={change}><span>{title}</span><i className={`toggle ${value?'on':''}`}/></button>}

function ProfileEditor({profile,save,close}:{profile:Profile;save:(p:Profile)=>void;close:()=>void}){const[p,setP]=useState(profile),set=(k:keyof Profile,v:string)=>setP({...p,[k]:v}),photo=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>set('photo',String(reader.result));reader.readAsDataURL(file)};return <form className="sub-screen editor" onSubmit={e=>{e.preventDefault();save(p)}}><button type="button" className="back" onClick={close}><ChevronLeft/></button><h1>Демо-профіль</h1><label className="photo-picker">{p.photo?<img src={p.photo} alt="Фото профілю"/>:<span><Upload/></span>}<b>Змінити фото</b><input type="file" accept="image/*" onChange={e=>photo(e.target.files?.[0])}/></label>{([['lastName','Прізвище'],['firstName','Ім’я'],['middleName','По батькові'],['birthDate','Дата народження'],['phone','Телефон'],['email','Email'],['city','Місто']] as const).map(([key,label])=><label className="edit-field" key={key}><span>{label}</span><input type={key==='birthDate'?'date':'text'} value={p[key]||''} onChange={e=>set(key,e.target.value)}/></label>)}<label className="edit-field"><span>Демонстраційний статус</span><select value={p.status} onChange={e=>set('status',e.target.value)}><option>Демонстраційний статус</option><option>Дані уточнено</option><option>Очікує оновлення</option></select></label><button className="orange-button">Зберегти локально</button></form>}

function QrSheet({value,seconds,regenerate,close}:{value:string;seconds:number;regenerate:()=>void;close:()=>void}){const timer=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;return <div className="sheet-back" onClick={close}><section className="qr-sheet" onClick={e=>e.stopPropagation()}><button className="sheet-close" onClick={close}><X/></button><p>ТЕСТОВИЙ QR — НЕ ДЛЯ ПЕРЕВІРКИ</p><h1>Демо-код</h1><div className="qr-box"><QRCodeSVG value={value} size={218} minVersion={qrVersion} level="M" boostLevel={false}/></div><code>{value}</code><small>QR оновиться через {timer}</small><strong>ТЕСТОВИЙ QR<br/>НЕ ПІДТВЕРДЖУЄ ОСОБУ<br/>НЕ МАЄ ЮРИДИЧНОЇ СИЛИ</strong><button className="orange-button" onClick={regenerate}>Оновити QR</button></section></div>}
