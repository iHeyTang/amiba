import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {GenerationConfirmation} from '../src/client/GenerationConfirmation';
import '../src/client/style.css';
import './style.css';
function Preview(){const [result,setResult]=useState('');return <main style={{width:'min(700px,95vw)',margin:'100px auto'}}><p style={{marginBottom:40}}>帮我生成一段日出时湖面的镜头。</p>{result?<p>{result}</p>:<GenerationConfirmation {...{request:{questions:[{id:'amiba.media.confirm',question:'Review',detail:JSON.stringify({provider:'TokenDance',model:'Seedance',price:'费用未知',parameters:{duration:5,resolution:'720p',ratio:'16:9',prompt:'日出时湖面升起薄雾，镜头缓慢推进。'}})}]},inFlight:false,error:null,respond:(answers:unknown)=>setResult(JSON.stringify(answers)),cancel:()=>setResult('已取消')} as any}/>}</main>};
createRoot(document.getElementById('root')!).render(<Preview/>);
