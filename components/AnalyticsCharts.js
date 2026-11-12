'use client';
import { useId, useState } from 'react';
import styles from './AnalyticsCharts.module.css';
const count=value=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:1}).format(value);
export function DonutChart({data,label}){
 const [active,setActive]=useState(null);const total=data.reduce((sum,row)=>sum+row.value,0),radius=64,length=2*Math.PI*radius;let offset=0;
 return <div className={styles.donutLayout}><svg className={styles.donut} viewBox="0 0 180 180" role="img" aria-label={`${label}: ${count(total)} tickets`}><circle cx="90" cy="90" r={radius} fill="none" stroke="var(--bg-tertiary)" strokeWidth="22"/>
  {data.map(row=>{const share=total?row.value/total:0,position=offset;offset+=share;return <circle key={row.id} cx="90" cy="90" r={radius} fill="none" stroke={row.color} strokeWidth={active===row.id?26:22} strokeDasharray={`${share*length} ${length}`} strokeDashoffset={-position*length} transform="rotate(-90 90 90)" opacity={active&&active!==row.id?0.35:1}><title>{row.label}: {count(row.value)} ({count(share*100)}%)</title></circle>;})}
  <text x="90" y="87" textAnchor="middle" className={styles.donutTotal}>{count(total)}</text><text x="90" y="107" textAnchor="middle" className={styles.donutCaption}>tickets</text>
 </svg><div className={styles.donutLegend}>{data.map(row=><button key={row.id} type="button" aria-pressed={active===row.id} onClick={()=>setActive(active===row.id?null:row.id)}><span className={styles.dot} style={{background:row.color}}/><span>{row.label}<small>{total?count(row.value/total*100):'0'}%</small></span><strong>{count(row.value)}</strong></button>)}</div></div>;
}
export function HorizontalBars({data,series,label,format=count}){
 const hasNegative=data.some(row=>series.some(item=>row[item.key]<0));const max=Math.max(1,...data.map(row=>series.reduce((sum,item)=>sum+Math.max(0,row[item.key]||0),0)),...data.map(row=>series.reduce((sum,item)=>sum+Math.abs(Math.min(0,row[item.key]||0)),0)));
 if(!data.length)return <p className={styles.empty}>No hay datos para estos filtros.</p>;
 return <div><div className={styles.legend}>{series.map(item=><span key={item.key}><i style={{background:item.color}}/>{item.label}</span>)}</div><div className={styles.barRows} role="group" aria-label={label}>{data.map((row,index)=>{let positive=hasNegative?50:0,negative=50;const details=series.map(item=>`${item.label}: ${format(row[item.key]||0)}`).join(' / ');return <div key={row.id??row.label??index} className={styles.barRow} tabIndex={0} aria-label={`${row.label}: ${details}`}><div className={styles.barHead}><span>{row.label}</span><strong>{format(series.reduce((sum,item)=>sum+(row[item.key]||0),0))}</strong></div><div className={styles.track}>{hasNegative&&<i className={styles.zero}/>} {series.map(item=>{const value=row[item.key]||0,width=Math.abs(value)/max*(hasNegative?50:100),left=value<0?negative-width:positive;if(value<0)negative-=width;else positive+=width;return <span key={item.key} style={{left:`${left}%`,width:`${width}%`,background:item.color}}/>;})}</div><p className={styles.rowDetail}>{details}</p></div>;})}</div></div>;
}
export function SeriesChart({data,series,label,format=count}){
 const [hidden,setHidden]=useState([]),[focus,setFocus]=useState(null);const title=useId();const visible=series.filter(item=>!hidden.includes(item.key));
 if(!data.length)return <p className={styles.empty}>No hay actividad para estos filtros.</p>;
 const width=720,height=265,left=70,right=18,top=15,bottom=35;
 const values=data.flatMap(row=>visible.map(item=>row[item.key]||0));const min=Math.min(0,...values),max=Math.max(1,...values),span=max-min;
 const x=i=>data.length===1?(left+width-right)/2:left+i*(width-left-right)/(data.length-1),y=value=>top+(max-value)/span*(height-top-bottom);
 const labelAt=row=>row.label||row.date;const point=focus!=null&&data[focus]?data[focus]:null;
 return <div><div className={styles.legend}>{series.map(item=><button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)} onClick={()=>setHidden(current=>current.includes(item.key)?current.filter(key=>key!==item.key):[...current,item.key])}><i style={{background:item.color}}/>{item.label}</button>)}</div>
  <svg className={styles.series} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={title} onPointerMove={event=>{const bounds=event.currentTarget.getBoundingClientRect();const at=(event.clientX-bounds.left)/bounds.width*width;setFocus(Math.max(0,Math.min(data.length-1,Math.round((at-left)/(width-left-right)*(data.length-1)))));}}><title id={title}>{label}. Valores disponibles al enfocar cada punto y en la tabla de datos.</title>
   {Array.from({length:5},(_,i)=>min+span*i/4).map((value,i)=><g key={i}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className={styles.grid}/><text x={left-8} y={y(value)+4} textAnchor="end" className={styles.axis}>{format(value)}</text></g>)}
   <line x1={left} x2={width-right} y1={y(0)} y2={y(0)} className={styles.baseline}/>
   {data.map((row,i)=>(i===0||i===data.length-1||i%Math.ceil(data.length/5)===0)&&<text key={i} x={x(i)} y={height-12} textAnchor={i===0?'start':i===data.length-1?'end':'middle'} className={styles.axis}>{labelAt(row)}</text>)}
   {visible.map(item=><g key={item.key}><polyline points={data.map((row,i)=>`${x(i)},${y(row[item.key]||0)}`).join(' ')} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round"/>{data.map((row,i)=><circle key={i} cx={x(i)} cy={y(row[item.key]||0)} r={focus===i?5:3.5} fill={item.color} tabIndex={0} aria-label={`${labelAt(row)}: ${item.label} ${format(row[item.key]||0)}`} onFocus={()=>setFocus(i)} onMouseEnter={()=>setFocus(i)}><title>{labelAt(row)}: {item.label} {format(row[item.key]||0)}</title></circle>)}</g>)}
  </svg><p className={styles.pointDetail} role="status">{point?`${labelAt(point)} · ${visible.map(item=>`${item.label}: ${format(point[item.key]||0)}`).join(' / ')}`:'Toca o enfoca un punto para ver sus valores. Las leyendas permiten ocultar series.'}</p>
  <details className={styles.dataTable}><summary>Ver tabla de datos</summary><div><table><thead><tr><th>Período</th>{series.map(item=><th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{data.map((row,i)=><tr key={i}><th>{labelAt(row)}</th>{series.map(item=><td key={item.key}>{format(row[item.key]||0)}</td>)}</tr>)}</tbody></table></div></details>
 </div>;
}
