// Deterministic horizontal score system balancing.
//
// Optimizes all lines together instead of greedily filling each line. The
// result is a MusicXML system/page BREAK PLAN, not collision-free engraving.
// No source mutation. Hard capacity is respected except for a single measure
// that is intrinsically wider than the nominal page capacity.
const fail=message=>{throw new Error(message);};
export function balanceMusicSystems(widths,{
  capacity=84,maxBars=6,breakPenalties=[],hardBreaks=[]
}={}){
  if(!Array.isArray(widths)||widths.length<1||widths.length>300||
     widths.some(x=>!Number.isFinite(x)||x<1||x>1e5)||
     !Number.isFinite(capacity)||capacity<20||capacity>1e5||
     !Number.isSafeInteger(maxBars)||maxBars<1||maxBars>16||
     !Array.isArray(breakPenalties)||
     breakPenalties.some(x=>!Number.isFinite(x)||x<0||x>1e6)||
     !Array.isArray(hardBreaks)||hardBreaks.some(x=>!Number.isSafeInteger(x)||
       x<1||x>=widths.length)||new Set(hardBreaks).size!==hardBreaks.length)
    fail('마디 밀도·페이지 폭·줄 나눔 설정을 확인해 주세요.');
  const n=widths.length,forced=new Set(hardBreaks);
  const cost=Array(n+1).fill(Infinity),choice=Array(n).fill(null);
  cost[n]=0;
  for(let start=n-1;start>=0;start--){
    let sum=0;
    for(let end=start+1;end<=Math.min(n,start+maxBars);end++){
      // A user-authored system/page boundary must never be crossed.
      if(end>start+1&&forced.has(end-1))break;
      sum+=widths[end-1];
      if(sum>capacity&&end-start>1)break;
      const count=end-start,last=end===n;
      const overflow=Math.max(0,sum-capacity);
      const slack=Math.max(0,capacity-sum);
      // Fullness is evaluated as a fraction: A4 portrait/landscape plans
      // remain comparable even when their nominal horizontal capacity differs.
      const fill=slack/capacity;
      const uneven=fill*fill*750*(last?0.6:1);
      const overfull=overflow>0?4000+overflow*overflow*30:0;
      // A lonely last measure is particularly disruptive to performers.
      const orphan=(last&&start>0&&count===1&&n>2)?850:0;
      const seam=last?0:breakPenalties[end]||0;
      const candidate=uneven+overfull+orphan+seam+cost[end];
      if(candidate<cost[start]-1e-8||
        Math.abs(candidate-cost[start])<=1e-8&&(choice[start]===null||end>choice[start])){
        cost[start]=candidate;
        choice[start]=end;
      }
    }
    if(choice[start]===null)fail('지원하지 않는 악보 밀도 때문에 줄 나눔을 계산할 수 없습니다.');
  }
  const starts=[],systemWidths=[],systemBars=[];
  let index=0;
  while(index<n){
    starts.push(index);
    const end=choice[index];
    if(!Number.isSafeInteger(end)||end<=index)
      fail('계산된 줄 경계에 잘못된 값이 있습니다.');
    systemWidths.push(widths.slice(index,end).reduce((a,b)=>a+b,0));
    systemBars.push(end-index);
    index=end;
  }
  return {systemStarts:starts,systemWeights:systemWidths,systemBars,
    score:cost[0],policy:'BALANCED_WIDTH_WITH_ORPHAN_AND_CONNECTION_PENALTIES'};
}
