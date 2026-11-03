import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '@/lib/client';
import { SESSION_RESTORED_EVENT } from '@/lib/session-events.mjs';

export function useAssignmentHistory(query,page,semester,from,to,enabled,source='assignments') {
  const [data,setData]=useState({assignments:[],changes:[],total:0,hasMore:false,summary:{}});
  const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);const [error,setError]=useState('');
  const controller=useRef(null);
  const refresh=useCallback(async({silent=false,background=false}={})=>{
    if(!enabled||(background&&controller.current)) return;
    controller.current?.abort();const current=new AbortController();controller.current=current;
    if(!silent) setLoading(true);setRefreshing(true);
    try {
      const params=new URLSearchParams({q:query,page:String(page),semester,...(from?{from}:{}),...(to?{to}:{})});
      const result=await requestJson(`/api/faculty/${source}?${params}`,{signal:current.signal});
      if(!current.signal.aborted&&controller.current===current) {setData(result);setError('');}
    } catch(issue) {if(!current.signal.aborted&&issue.status!==401) setError(issue.message);}
    finally {if(controller.current===current) {controller.current=null;if(!current.signal.aborted) {setLoading(false);setRefreshing(false);}}}
  },[query,page,semester,from,to,enabled,source]);
  useEffect(()=>{
    if(!enabled) return;
    const timer=setTimeout(refresh,250);const resume=()=>refresh({silent:true});
    window.addEventListener(SESSION_RESTORED_EVENT,resume);
    return()=>{clearTimeout(timer);controller.current?.abort();controller.current=null;window.removeEventListener(SESSION_RESTORED_EVENT,resume);};
  },[enabled,refresh]);
  return {...data,loading,refreshing,error,refresh};
}
