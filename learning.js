(function(scope){
// Machine learning: an online logistic-regression model that predicts how likely you are to recall an ayah.
// Reinforcement learning: a non-stationary multi-armed bandit (UCB) that picks which ayah to review next.
// Supervised learning: a classifier trained on your labels of which flagged mistakes were really yours.
// All of them learn only from your own reviews and run entirely in the browser.
const HOUR=36e5;
// Starting weights (bias, time since review, last score, mean score, review count, ayah length); refined by every review.
const PRIOR=[-2,-2.5,2.5,2,0.6,-0.5];
function features(stat,now,words){
 const hours=stat?Math.max(0,(now-stat.last)/HOUR):0;
 return [1,Math.log1p(hours)/5,stat?stat.lastScore/100:0,stat?stat.mean/100:0,Math.log1p(stat?stat.n:0)/3,Math.min(words,60)/30];
}
const sigmoid=z=>1/(1+Math.exp(-z));
function predict(weights,x){return sigmoid(x.reduce((sum,v,i)=>sum+v*weights[i],0));}
function createState(){return {weights:PRIOR.slice(),updates:0,ayat:{},pulls:0,clf:createClassifier()};}
// Returns the recall probability, or null for an ayah never reviewed (nothing to base a prediction on).
function recall(state,key,now,words){const stat=state.ayat[key];return stat?predict(state.weights,features(stat,now,words)):null;}
function learn(state,key,score,now,words){
 const stat=state.ayat[key],y=score/100;
 // Train on the prediction made before this review: did the model expect this outcome?
 if(stat){const x=features(stat,now,words),error=y-predict(state.weights,x),rate=0.15/Math.sqrt(1+state.updates/20);state.weights=state.weights.map((w,i)=>w+rate*error*x[i]);state.updates++;}
 // Bandit reward: a review that uncovers mistakes was worth doing; a perfect one less so.
 const reward=1-y,next=stat||{n:0,mean:0,q:1};
 next.q+=0.3*(reward-next.q);
 next.mean=(next.mean*next.n+score)/(next.n+1);next.n++;next.lastScore=score;next.last=now;
 state.ayat[key]=next;state.pulls++;
 return next;
}
// UCB: value of reviewing = blend of learned reward (Q) and predicted forgetting, plus an exploration bonus.
function choose(state,candidates,now,exclude){
 let best=null;
 for(const {key,words}of candidates){
  if(key===exclude)continue;
  const stat=state.ayat[key];
  const value=stat?0.5*stat.q+0.5*(1-recall(state,key,now,words)):1;
  const bonus=0.35*Math.sqrt(Math.log(state.pulls+2)/((stat?stat.n:0)+1));
  const score=value+bonus;
  if(!best||score>best.score)best={key,score,value,bonus,stat:stat||null};
 }
 return best;
}
// Supervised learning: a logistic-regression classifier trained on mistakes you label yourself,
// predicting whether a flagged mistake is a speech-recognition error rather than a recitation error.
const CONFUSABLE=[['ث','س','ص'],['ذ','ز','ظ'],['ض','ظ','د'],['ط','ت'],['ق','ك'],['ح','ه'],['ع','ا','ء'],['ة','ه','ت'],['ن','م']];
const confusable=(a,b)=>CONFUSABLE.some(group=>group.includes(a)&&group.includes(b));
// Features: bias, missing, extra, changed, share of letters edited, share of edits between similar-sounding letters, word length, on-device engine.
const CLF_PRIOR=[-0.3,0.3,0,0,1.2,1.5,-0.3,0];
function mistakeFeatures({type,ops=[],length=0,device=false}){
 const subs=ops.filter(o=>o.op==='sub');
 return [1,type==='missing'?1:0,type==='extra'?1:0,type==='changed'?1:0,type==='changed'&&length?Math.min(1,ops.length/length):0,subs.length?subs.filter(o=>confusable(o.from,o.to)).length/subs.length:0,Math.min(length,10)/10,device?1:0];
}
function createClassifier(){return {weights:CLF_PRIOR.slice(),n:0,correct:0};}
function classify(clf,x){return predict(clf.weights,x);}
function label(clf,x,isRecognitionError){
 const p=classify(clf,x),y=isRecognitionError?1:0;
 // Score the prediction before learning from the label, so accuracy reflects unseen examples.
 if((p>=0.5)===isRecognitionError)clf.correct++;
 const rate=0.4/Math.sqrt(1+clf.n/10);clf.weights=clf.weights.map((w,i)=>w+rate*(y-p)*x[i]);clf.n++;
 return p;
}
const api={features,predict,createState,recall,learn,choose,PRIOR,mistakeFeatures,createClassifier,classify,label,confusable};
if(typeof module!=='undefined')module.exports=api;else scope.QuranLearning=api;
})(globalThis);
