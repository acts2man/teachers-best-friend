import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
function bundle(path){const result=buildSync({entryPoints:[path],bundle:true,platform:"node",format:"cjs",write:false});const shim={exports:{}};new Function("module","exports",result.outputFiles[0].text)(shim,shim.exports);return shim.exports}
const {matchRosterStudent,groupPagesByName,resolveScannedGroups,applyScannedGroups}=bundle("lib/teacher-class-scan.ts");

function assessment(){
  return {
    id:"a1",classId:"c1",title:"Quiz",subject:"Math",grade:4,framework:"Common Core",createdAt:"",status:"Ready",
    questions:[{id:"q1",number:1,text:"1+1",passage:"",answer:"2",standard:"4.OA.1",secondary:"",skill:"",dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false}],
    responses:[],uploadIds:[],source:"manual",targetStandards:["4.OA.1"],studentUploadIds:{},
  };
}
function student(id,name,classId="c1"){return {id,classId,name,color:"#000",evidence:[],notes:""}}

test("exact roster name matches regardless of case and spacing",()=>{
  const students=[student("s1"," Maria  Gonzalez ")];
  assert.equal(matchRosterStudent("maria gonzalez",students).id,"s1");
});
test("first-name + last-initial matches a shortened name",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Jamal Thompson")];
  assert.equal(matchRosterStudent("Maria G.",students)?.id,"s1");
  assert.equal(matchRosterStudent("Maria Gonzalez",students).id,"s1");
});
test("an ambiguous shortened name resolves to the first roster match, in roster order — the teacher still confirms it before saving",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Maria Garcia")];
  assert.equal(matchRosterStudent("Maria G.",students)?.id,"s1");
});
test("a single-token name never matches (too ambiguous to guess)",()=>{
  const students=[student("s1","Maria Gonzalez")];
  assert.equal(matchRosterStudent("Maria",students),undefined);
});
test("no match returns undefined rather than guessing",()=>{
  const students=[student("s1","Maria Gonzalez")];
  assert.equal(matchRosterStudent("Jamal Thompson",students),undefined);
});

const name=(page,n,c=90)=>({page,name:n,confidence:n?c:0});

test("a named page starts a student and unnamed pages after it continue them",()=>{
  const groups=groupPagesByName([name(0,"Maria"),name(1,""),name(2,"Jamal"),name(3,""),name(4,"")]);
  assert.deepEqual(groups,[[0,1],[2,3,4]]);
});
test("every page gets a student when every page is named",()=>{
  assert.deepEqual(groupPagesByName([name(0,"A"),name(1,"B"),name(2,"C")]),[[0],[1],[2]]);
});
test("pages before any name become their own group rather than vanishing",()=>{
  // A stray back side on top of the pile. Nothing the teacher scanned is dropped.
  const groups=groupPagesByName([name(0,""),name(1,""),name(2,"Maria")]);
  assert.deepEqual(groups,[[0,1],[2]]);
});
test("a whitespace-only name does not start a new student",()=>{
  assert.deepEqual(groupPagesByName([name(0,"Maria"),name(1,"   ")]),[[0,1]]);
});
test("no pages means no groups",()=>{
  assert.deepEqual(groupPagesByName([]),[]);
});

test("resolveScannedGroups clamps page indexes to the real upload list and dedupes",()=>{
  const resolved=resolveScannedGroups([[0,0,5,-1]],[name(0,"Jamal T")],[],["u1","u2"],[]);
  assert.deepEqual(resolved[0].pageIndexes,[0]);
  assert.deepEqual(resolved[0].pageUploadIds,["u1"]);
});
test("resolveScannedGroups matches the roster locally, then falls back to a placeholder name",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Jamal Thompson")];
  const resolved=resolveScannedGroups(
    [[0],[1],[2]],
    [name(0,"Maria Gonzalez"),name(1,"Jamal T."),name(2,"")],
    [],["u1","u2","u3"],students);
  assert.equal(resolved[0].studentId,"s1");
  assert.equal(resolved[1].studentId,"s2");
  assert.equal(resolved[2].studentId,null);
  assert.equal(resolved[2].name,"Student 3");
});
test("an unreadable name is left for the teacher rather than guessed from the roster",()=>{
  const students=[student("s1","Maria Gonzalez")];
  const resolved=resolveScannedGroups([[0]],[name(0,"illegible",10)],[],["u1"],students);
  assert.equal(resolved[0].studentId,null);
  assert.equal(resolved[0].name,"illegible");
});
test("grading is attached to the group it was returned for, not the order it arrived in",()=>{
  const r=[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:99}];
  const resolved=resolveScannedGroups(
    [[0],[1]],
    [name(0,"Maria"),name(1,"Jamal")],
    [{group:1,responses:r}],           // second group graded, reported first
    ["u1","u2"],[]);
  assert.equal(resolved[0].responses.length,0);
  assert.equal(resolved[1].responses.length,1);
  assert.equal(resolved[1].detectedName,"Jamal");
});
test("a student the grading pass skipped still appears for the teacher to see",()=>{
  const resolved=resolveScannedGroups([[0],[1]],[name(0,"Maria"),name(1,"Jamal")],[],["u1","u2"],[]);
  assert.equal(resolved.length,2);
  assert.deepEqual(resolved.map(g=>g.name),["Maria","Jamal"]);
});
test("a multi-page student takes the name from whichever page carried one",()=>{
  const resolved=resolveScannedGroups([[0,1,2]],[name(0,"Maria Gonzalez"),name(1,""),name(2,"")],[],["u1","u2","u3"],[]);
  assert.equal(resolved[0].detectedName,"Maria Gonzalez");
  assert.deepEqual(resolved[0].pageUploadIds,["u1","u2","u3"]);
});

test("applyScannedGroups grades a matched student and creates a record for an unmatched one",()=>{
  const a=assessment();
  const students=[student("s1","Maria Gonzalez")];
  const result=applyScannedGroups(a,students,"c1",[
    {studentId:"s1",name:"Maria Gonzalez",pageUploadIds:["u1"],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
    {studentId:null,name:"New Kid",pageUploadIds:["u2"],responses:[{questionId:"q1",answer:"3",correct:false,match:0,misconception:"Miscounted",confidence:90}]},
  ]);
  assert.equal(result.newStudents.length,1);
  assert.equal(result.newStudents[0].name,"New Kid");
  assert.equal(result.students.length,2);
  assert.equal(result.assessment.responses.length,2);
  assert.ok(result.assessment.responses.some(r=>r.studentId==="s1"&&r.correct===true));
  assert.ok(result.assessment.responses.some(r=>r.studentId===result.newStudents[0].id&&r.correct===false));
  assert.deepEqual(result.assessment.studentUploadIds.s1,["u1"]);
  assert.deepEqual(result.assessment.studentUploadIds[result.newStudents[0].id],["u2"]);
  assert.deepEqual(result.assessment.uploadIds.slice().sort(),["u1","u2"]);
  assert.equal(result.studentCount,2);
});

test("applyScannedGroups replaces a student's prior responses for this assessment rather than duplicating them",()=>{
  const a=assessment();
  a.responses=[{id:"old",studentId:"s1",questionId:"q1",answer:"1",correct:false,match:0,misconception:"",confidence:80,verified:true}];
  const students=[student("s1","Maria Gonzalez")];
  const result=applyScannedGroups(a,students,"c1",[
    {studentId:"s1",name:"Maria Gonzalez",pageUploadIds:["u1"],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
  ]);
  assert.equal(result.assessment.responses.length,1);
  assert.equal(result.assessment.responses[0].correct,true);
});

test("a group with no pages or no responses is skipped entirely",()=>{
  const a=assessment();
  const result=applyScannedGroups(a,[],"c1",[
    {studentId:null,name:"Empty",pageUploadIds:[],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
    {studentId:null,name:"No answers",pageUploadIds:["u1"],responses:[]},
  ]);
  assert.equal(result.newStudents.length,0);
  assert.equal(result.assessment.responses.length,0);
});

// Ricky's bug, kept from coming back: a ten-question test across two pages,
// photographed a page at a time, came back "5 of 10 blank" for every student
// because each page was graded against the whole key on its own.
const {groupPagesByCapture}=bundle("lib/teacher-class-scan.ts");
const {mergeStudentResponses}=bundle("lib/teacher-workflow.ts");

test("pages the teacher put under one student stay in one group",()=>{
  assert.deepEqual(groupPagesByCapture([2,2,2]),[[0,1],[2,3],[4,5]]);
});
test("students with uneven page counts each keep all their pages",()=>{
  assert.deepEqual(groupPagesByCapture([1,3,2]),[[0],[1,2,3],[4,5]]);
});
test("an empty pile from a stray 'next student' tap is skipped, not graded",()=>{
  assert.deepEqual(groupPagesByCapture([2,0,1]),[[0,1],[2]]);
  assert.deepEqual(groupPagesByCapture([0]),[]);
});
test("every scanned page lands in exactly one group",()=>{
  const sizes=[3,1,2,4];
  const flat=groupPagesByCapture(sizes).flat();
  assert.deepEqual(flat,[...Array(sizes.reduce((a,b)=>a+b,0)).keys()]);
});

const resp=(questionId,answer)=>({id:"r-"+questionId,studentId:"s1",questionId,answer,correct:!!answer,match:answer?100:0,misconception:"",confidence:answer?99:0,verified:false});

test("a second page does not blank out the answers the first page supplied",()=>{
  // Page 1 answered q1-q2; the page-2 pass can only see q3 and truthfully
  // reports q1-q2 as not visible.
  const page1=[resp("q1","20"),resp("q2","15%"),resp("q3","")];
  const page2=[resp("q1",""),resp("q2",""),resp("q3","65%")];
  const merged=mergeStudentResponses(page1,page2);
  assert.deepEqual(merged.map(r=>r.answer),["20","15%","65%"]);
});
test("re-scanning the same page still overwrites it",()=>{
  const first=[resp("q1","20")];
  const corrected=[resp("q1","28")];
  assert.deepEqual(mergeStudentResponses(first,corrected).map(r=>r.answer),["28"]);
});
test("merging onto nothing keeps the incoming pass as-is",()=>{
  const incoming=[resp("q1","20"),resp("q2","")];
  assert.deepEqual(mergeStudentResponses([],incoming),incoming);
});

// Taking a student off a roster. There was no way to do this until a pilot
// teacher asked -- and scanning a stack can create a student from a misread
// name, so without it those were permanent.
const {removeStudent}=bundle("lib/teacher-classes.ts");

function workspace(){
  const a=assessment();
  return {
    classes:[{id:"c1",name:"P2",grade:4,framework:"Common Core"}],
    students:[student("s1","Maria Gonzalez"),student("s2","Jamal Thompson")],
    assessments:[{...a,
      responses:[
        {id:"r1",studentId:"s1",questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:99,verified:false},
        {id:"r2",studentId:"s2",questionId:"q1",answer:"3",correct:false,match:0,misconception:"",confidence:99,verified:false},
      ],
      studentUploadIds:{s1:["u1","u2"],s2:["u3"]},
    }],
    groups:[{id:"g1",classId:"c1",name:"Reteach",studentIds:["s1","s2"]}],
  };
}

test("removing a student takes their record, answers and pages with them",()=>{
  const next=removeStudent(workspace(),"s1");
  assert.deepEqual(next.students.map(s=>s.id),["s2"]);
  assert.deepEqual(next.assessments[0].responses.map(r=>r.studentId),["s2"]);
  assert.deepEqual(Object.keys(next.assessments[0].studentUploadIds),["s2"]);
  assert.deepEqual(next.groups[0].studentIds,["s2"]);
});
test("removing a student leaves everyone else's work untouched",()=>{
  const before=workspace();
  const next=removeStudent(before,"s1");
  assert.deepEqual(next.assessments[0].responses[0],before.assessments[0].responses[1]);
  assert.deepEqual(next.assessments[0].studentUploadIds.s2,["u3"]);
});
test("removing a student who does not exist changes nothing",()=>{
  const before=workspace();
  const next=removeStudent(before,"nobody");
  assert.deepEqual(next.students,before.students);
  assert.deepEqual(next.assessments[0].responses,before.assessments[0].responses);
});
test("removing a student works on a workspace with no groups",()=>{
  const noGroups=workspace();
  delete noGroups.groups;
  const next=removeStudent(noGroups,"s1");
  assert.deepEqual(next.students.map(s=>s.id),["s2"]);
  assert.deepEqual(next.groups,[]);
});

// Student work photos are deleted once the grading that came off them is
// confirmed -- what both pilot teachers asked for. These guard the two ways
// that could go wrong: deleting a teacher's own documents, and deleting a page
// whose grading is still in progress.
const {releasedStudentUploads,forgetUploads}=bundle("lib/teacher-workflow.ts");

function graded(verifiedFor){
  const questions=[
    {id:"q1",number:1,text:"a",passage:"",answer:"1",standard:"4.OA.1",secondary:"",skill:"",dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false},
    {id:"q2",number:2,text:"b",passage:"",answer:"2",standard:"4.OA.1",secondary:"",skill:"",dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false},
  ];
  const resp=(studentId,questionId)=>({
    id:studentId+"-"+questionId,studentId,questionId,answer:"1",correct:true,match:100,
    misconception:"",confidence:99,verified:verifiedFor.includes(studentId),
  });
  return {
    id:"a1",classId:"c1",title:"Quiz",subject:"Math",grade:4,framework:"Common Core",createdAt:"",
    status:"Ready",source:"manual",targetStandards:["4.OA.1"],answerKeyVerified:true,questions,
    responses:["s1","s2"].flatMap(sid=>questions.map(q=>resp(sid,q.id))),
    // p1/p2 are s1's scanned pages, p3 is s2's. blank1 and key1 are the
    // teacher's own documents and must never be released.
    uploadIds:["blank1","key1","p1","p2","p3"],
    studentUploadIds:{s1:["p1","p2"],s2:["p3"]},
  };
}

test("a student's pages are released once all their grading is confirmed",()=>{
  assert.deepEqual(releasedStudentUploads(graded(["s1"])).sort(),["p1","p2"]);
});
test("the blank assessment and answer key are never released",()=>{
  const released=releasedStudentUploads(graded(["s1","s2"]));
  assert.equal(released.includes("blank1"),false);
  assert.equal(released.includes("key1"),false);
  assert.deepEqual(released.sort(),["p1","p2","p3"]);
});
test("nothing is released while grading is still unconfirmed",()=>{
  assert.deepEqual(releasedStudentUploads(graded([])),[]);
});
test("a page a still-in-progress student points at is held back",()=>{
  const a=graded(["s1"]);
  a.studentUploadIds={s1:["p1","shared"],s2:["shared"]};
  assert.deepEqual(releasedStudentUploads(a),["p1"]);
});
test("forgetUploads unlinks the released pages and leaves the rest",()=>{
  const a=graded(["s1"]);
  const next=forgetUploads(a,["p1","p2"]);
  assert.deepEqual(next.studentUploadIds,{s1:[],s2:["p3"]});
  assert.deepEqual(next.uploadIds,["blank1","key1","p3"]);
});
test("forgetUploads with nothing released returns the assessment untouched",()=>{
  const a=graded([]);
  assert.equal(forgetUploads(a,[]),a);
});

// Clearing a roster back to empty: the students and their work go, the
// teacher's own assessments and answer keys stay.
const {clearClassStudents}=bundle("lib/teacher-classes.ts");

function twoClasses(){
  const a=assessment();
  return {
    classes:[{id:"c1",name:"P2"},{id:"c2",name:"P3"}],
    students:[student("s1","Maria G."),student("s2","Jamal T."),student("s3","Ana R.","c2")],
    assessments:[{...a,
      responses:[
        {id:"r1",studentId:"s1",questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:99,verified:true},
        {id:"r3",studentId:"s3",questionId:"q1",answer:"4",correct:false,match:0,misconception:"",confidence:99,verified:true},
      ],
      uploadIds:["blank1","key1","p1","p2","p3"],
      studentUploadIds:{s1:["p1"],s2:["p2"],s3:["p3"]},
    }],
    groups:[{id:"g1",classId:"c1",name:"Reteach",studentIds:["s1","s2","s3"]}],
  };
}

test("clearing a roster removes that class's students and returns their pages to delete",()=>{
  const out=clearClassStudents(twoClasses(),"c1");
  assert.equal(out.studentCount,2);
  assert.deepEqual(out.workspace.students.map(s=>s.id),["s3"]);
  assert.deepEqual(out.uploadIds.sort(),["p1","p2"]);
});
test("clearing a roster keeps the assessment, its questions and the answer key pages",()=>{
  const out=clearClassStudents(twoClasses(),"c1");
  const a=out.workspace.assessments[0];
  assert.equal(a.questions.length,1);
  assert.ok(a.uploadIds.includes("blank1"));
  assert.ok(a.uploadIds.includes("key1"));
});
test("clearing one class leaves another class's students and work untouched",()=>{
  const out=clearClassStudents(twoClasses(),"c1");
  const a=out.workspace.assessments[0];
  assert.deepEqual(a.responses.map(r=>r.studentId),["s3"]);
  assert.deepEqual(a.studentUploadIds,{s3:["p3"]});
  assert.ok(a.uploadIds.includes("p3"));
  assert.deepEqual(out.workspace.groups[0].studentIds,["s3"]);
});
test("clearing a class with no students is a no-op",()=>{
  const w=twoClasses();
  w.students=w.students.filter(s=>s.classId!=="c1");
  const out=clearClassStudents(w,"c1");
  assert.equal(out.studentCount,0);
  assert.deepEqual(out.uploadIds,[]);
});

// Grading a class set by question: every student who wrote the same answer is
// one decision, not thirty-six. Ricky's request, and it costs no extra AI --
// the answers were all read during grading already.
const {groupAnswers,applyGroupScore,answerKey}=bundle("lib/teacher-workflow.ts");

function classSet(answers){
  const q={id:"q1",number:1,text:"5.2?",passage:"",answer:"5.2",standard:"7.RP.3",secondary:"",
    skill:"",dok:2,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false};
  return {
    id:"a1",classId:"c1",title:"Quiz",subject:"Math",grade:7,framework:"California",createdAt:"",
    status:"Ready",source:"manual",targetStandards:["7.RP.3"],answerKeyVerified:true,
    uploadIds:[],studentUploadIds:{},questions:[q],
    responses:answers.map(([sid,answer,correct,match],i)=>({
      id:"r"+i,studentId:sid,questionId:"q1",answer,correct:!!correct,
      match:match??(correct?100:0),misconception:"",confidence:99,verified:false,
    })),
  };
}

test("students who wrote the same answer land in one group",()=>{
  const a=classSet([["s1","5.2",true],["s2","5.2",true],["s3","9.2",false,50]]);
  const g=groupAnswers(a,"q1");
  assert.equal(g.length,2);
  assert.equal(g[0].studentIds.length,2);
  assert.deepEqual(g[0].studentIds,["s1","s2"]);
});
test("the biggest group comes first, so the decision clearing most papers is on top",()=>{
  const a=classSet([["s1","9.2",false,50],["s2","5.2",true],["s3","5.2",true],["s4","5.2",true]]);
  assert.equal(groupAnswers(a,"q1")[0].answer,"5.2");
  assert.equal(groupAnswers(a,"q1")[0].studentIds.length,3);
});
test("spacing, case and trailing punctuation do not split a group",()=>{
  assert.equal(answerKey(" 65 % "),answerKey("65%"));
  assert.equal(answerKey("Yes."),answerKey("yes"));
  assert.equal(answerKey("1,200"),answerKey("1200"));
});
test("different answers are never merged",()=>{
  assert.notEqual(answerKey("5.2"),answerKey("52"));
  assert.notEqual(answerKey("9.2"),answerKey("5.2"));
});
test("blanks and clean matches need no decision; partials do",()=>{
  const a=classSet([["s1","",false],["s2","5.2",true],["s3","9.2",false,50]]);
  const byAnswer=Object.fromEntries(groupAnswers(a,"q1").map(g=>[g.answer||"(blank)",g.needsDecision]));
  assert.equal(byAnswer["(blank)"],false);
  assert.equal(byAnswer["5.2"],false);
  assert.equal(byAnswer["9.2"],true);
});
test("one decision grades everyone in the group and confirms them",()=>{
  const a=classSet([["s1","9.2",false,50],["s2","9.2",false,50],["s3","5.2",true]]);
  const group=groupAnswers(a,"q1").find(g=>g.answer==="9.2");
  const next=applyGroupScore(a,group.responseIds,50);
  const graded=next.responses.filter(r=>group.responseIds.includes(r.id));
  assert.equal(graded.length,2);
  assert.ok(graded.every(r=>r.match===50&&r.verified&&!r.correct));
  // everyone else is untouched
  assert.equal(next.responses.find(r=>r.studentId==="s3").verified,false);
});
test("full credit through a group marks the answers correct",()=>{
  const a=classSet([["s1","5.20",false,90]]);
  const group=groupAnswers(a,"q1")[0];
  const r=applyGroupScore(a,group.responseIds,100).responses[0];
  assert.equal(r.match,100);
  assert.equal(r.correct,true);
});
test("a score outside 0-100 is clamped rather than saved",()=>{
  const a=classSet([["s1","9.2",false,50]]);
  const g=groupAnswers(a,"q1")[0];
  assert.equal(applyGroupScore(a,g.responseIds,150).responses[0].match,100);
  assert.equal(applyGroupScore(a,g.responseIds,-20).responses[0].match,0);
});

// Splitting a class scan into requests that actually fit. Measured from real
// scans: one student averages ~1,173 output tokens and peaks near 4,933 on a
// ten-question test, against a 12,000 ceiling -- so a full class set asked for
// more than the model would return and came back incomplete.
const {planScanBatches,studentsPerBatch,TOKENS_PER_ANSWER,BATCH_OUTPUT_BUDGET}=bundle("lib/teacher-class-scan.ts");

test("a ten-question test fits several students per request, not twelve",()=>{
  const n=studentsPerBatch(10);
  assert.ok(n>=4&&n<=8,"expected a handful per batch, got "+n);
  assert.ok(n*10*TOKENS_PER_ANSWER<=BATCH_OUTPUT_BUDGET);
});
test("a longer test puts fewer students in each request",()=>{
  assert.ok(studentsPerBatch(40)<studentsPerBatch(10));
  assert.ok(studentsPerBatch(10)<studentsPerBatch(2));
});
test("even an enormous test still grades one student per request",()=>{
  assert.equal(studentsPerBatch(10000),1);
  assert.equal(studentsPerBatch(0),studentsPerBatch(1));
});
test("every student's pages stay together in one request",()=>{
  const groups=[[0,1],[2,3],[4,5],[6,7]];
  const ids=["a","b","c","d","e","f","g","h"];
  for(const batch of planScanBatches(groups,ids,10,2500)){
    for(const g of batch.groups) assert.ok(g.length===2,"a student was split across requests");
  }
});
test("batches re-number their groups against their own uploads",()=>{
  const groups=[[0,1],[2,3],[4,5]];
  const ids=["a","b","c","d","e","f"];
  const batches=planScanBatches(groups,ids,10,2500); // one student per batch
  assert.equal(batches.length,3);
  assert.deepEqual(batches[0].uploadIds,["a","b"]);
  assert.deepEqual(batches[0].groups,[[0,1]]);
  assert.deepEqual(batches[1].uploadIds,["c","d"]);
  assert.deepEqual(batches[1].groups,[[0,1]]);
  assert.deepEqual(batches[2].groupIndexes,[2]);
});
test("every student in the scan lands in exactly one batch",()=>{
  const groups=Array.from({length:36},(_,i)=>[i]);
  const ids=groups.map((_,i)=>"u"+i);
  const batches=planScanBatches(groups,ids,10);
  const seen=batches.flatMap(b=>b.groupIndexes).sort((a,b)=>a-b);
  assert.deepEqual(seen,[...Array(36).keys()]);
});
test("no batch asks for more than the budget allows",()=>{
  const groups=Array.from({length:36},(_,i)=>[i*2,i*2+1]);
  const ids=Array.from({length:72},(_,i)=>"u"+i);
  for(const b of planScanBatches(groups,ids,10))
    assert.ok(b.groups.length*10*TOKENS_PER_ANSWER<=BATCH_OUTPUT_BUDGET);
});
test("pages outside the uploaded list are dropped, not sent as bad indexes",()=>{
  const batches=planScanBatches([[0,99]],["a"],10);
  assert.deepEqual(batches[0].uploadIds,["a"]);
  assert.deepEqual(batches[0].groups,[[0]]);
});

// The planning budget and the stage's real ceiling have to stay in step. If a
// batch is planned against more room than the model will return, the plan is
// fiction and the scan comes back incomplete -- which is the failure this
// batching was built to stop.
test("the batch budget stays under the class_scan output ceiling",()=>{
  const server=readFileSync("lib/analyze-server.ts","utf8");
  const m=server.match(/class_scan:\s*\{[^}]*maxOutput:\s*(\d+)/);
  assert.ok(m,"could not find the class_scan ceiling");
  const ceiling=Number(m[1]);
  assert.ok(
    BATCH_OUTPUT_BUDGET < ceiling,
    "planning budget "+BATCH_OUTPUT_BUDGET+" is not under the ceiling "+ceiling,
  );
  // And enough headroom that a verbose batch has somewhere to go.
  assert.ok(ceiling - BATCH_OUTPUT_BUDGET >= 4000, "not enough headroom over the budget");
});

// Telling a teacher on bad classroom wifi that the building is the problem,
// rather than letting them retake a photograph that was never the issue.
const {describeFailure}=bundle("lib/connection.ts");

test("a dropped connection is named as one, not as a bad file",()=>{
  const msg=describeFailure(new TypeError("Failed to fetch"),"That page couldn't be uploaded.");
  assert.match(msg,/connection dropped/i);
  assert.match(msg,/saved/i);
});
test("other network wordings browsers use are recognised too",()=>{
  for(const wording of ["NetworkError when attempting to fetch resource.","Load failed","Network request failed"])
    assert.match(describeFailure(new Error(wording),"fallback"),/connection dropped/i);
});
test("a real server message is passed through untouched",()=>{
  assert.equal(
    describeFailure(new Error("That file is larger than 12 MB."),"fallback"),
    "That file is larger than 12 MB.",
  );
});
test("something thrown that is not an Error still gets the fallback",()=>{
  assert.equal(describeFailure("boom","Upload failed."),"Upload failed.");
  assert.equal(describeFailure(undefined,"Upload failed."),"Upload failed.");
});

// The gradebook export. These numbers get typed into a district system and
// become a child's grade, so the rules have to be the ones the teacher was
// told: only confirmed answers count, and a half-reviewed class says so.
const {gradebookCsv}=bundle("lib/teacher-workflow.ts");

function scored(rows){
  const questions=[1,2].map(n=>({id:"q"+n,number:n,text:"q"+n,passage:"",answer:"a",standard:"7.RP.3",
    secondary:"",skill:"",dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false}));
  return {
    id:"a1",classId:"c1",title:"3.1 Quiz",subject:"Math",grade:7,framework:"California",createdAt:"",
    status:"Ready",source:"manual",targetStandards:["7.RP.3"],answerKeyVerified:true,
    uploadIds:[],studentUploadIds:{},questions,
    responses:rows.map(([sid,qid,match,verified],i)=>({
      id:"r"+i,studentId:sid,questionId:qid,answer:"x",correct:match===100,
      match,misconception:"",confidence:99,verified,
    })),
  };
}
const asRows=(csv)=>csv.split("\n").map(line=>line.match(/"([^"]|"")*"/g).map(c=>c.slice(1,-1).replace(/""/g,'"')));

test("one row per student, one column per question, plus the score",()=>{
  const a=scored([["s1","q1",100,true],["s1","q2",50,true]]);
  const rows=asRows(gradebookCsv(a,[student("s1","Maria G.")]));
  assert.deepEqual(rows[0],["Student","Q1","Q2","Score %","Points","Reviewed"]);
  assert.deepEqual(rows[1],["Maria G.","100","50","75","2/2","Yes"]);
});
test("an answer the teacher has not confirmed is left blank, not counted",()=>{
  const a=scored([["s1","q1",100,true],["s1","q2",0,false]]);
  const rows=asRows(gradebookCsv(a,[student("s1","Maria G.")]));
  assert.equal(rows[1][2],"","an unconfirmed answer was exported as a grade");
  assert.equal(rows[1][3],"100");
  assert.equal(rows[1][5],"Partly");
});
test("a student with nothing reviewed is obvious rather than a zero",()=>{
  const a=scored([["s1","q1",100,false]]);
  const rows=asRows(gradebookCsv(a,[student("s1","Maria G.")]));
  assert.equal(rows[1][3],"","an unreviewed student was exported as a score");
  assert.equal(rows[1][5],"No");
});
test("a name containing a comma or quote does not break the columns",()=>{
  const a=scored([["s1","q1",100,true],["s1","q2",100,true]]);
  const rows=asRows(gradebookCsv(a,[student("s1",'O\'Neill, Sarah "Sadie"')]));
  assert.equal(rows[1][0],'O\'Neill, Sarah "Sadie"');
  assert.equal(rows[1].length,6);
});
test("every student on the roster appears, graded or not",()=>{
  const a=scored([["s1","q1",100,true]]);
  const rows=asRows(gradebookCsv(a,[student("s1","A B."),student("s2","C D."),student("s3","E F.")]));
  assert.equal(rows.length,4);
  assert.deepEqual(rows.slice(1).map(r=>r[0]),["A B.","C D.","E F."]);
});

// Using one assessment across several periods. A teacher who gives the same
// test three times should set it up once, and each period must still get its
// own results.
const {assessmentFitsClass,shareAssessmentWith,assessmentClassIds,assessmentInClass}=bundle("lib/teacher-classes.ts");

const cls=(id,grade=7,framework="California")=>({id,name:id,grade,framework,demo:false});
const quiz={id:"a1",classId:"p2",title:"Quiz",subject:"Math",grade:7,framework:"California",
  createdAt:"",status:"Ready",source:"manual",targetStandards:[],questions:[],responses:[],uploadIds:[]};

test("another period of the same grade and framework is a match",()=>{
  assert.equal(assessmentFitsClass(quiz,cls("p3")),true);
});
test("a different grade or framework is flagged as a mismatch, not refused",()=>{
  assert.equal(assessmentFitsClass(quiz,cls("p5",4)),false);
  assert.equal(assessmentFitsClass(quiz,cls("p6",7,"Texas")),false);
  // Still shareable -- the teacher decides, the app only says what it costs.
  assert.ok(assessmentInClass(shareAssessmentWith(quiz,["p5"]),"p5"));
});
test("sharing adds the class and keeps the original",()=>{
  const shared=shareAssessmentWith(quiz,["p3"]);
  assert.deepEqual(assessmentClassIds(shared).sort(),["p2","p3"]);
  assert.ok(assessmentInClass(shared,"p2"));
  assert.ok(assessmentInClass(shared,"p3"));
});
test("sharing twice does not duplicate a class",()=>{
  const once=shareAssessmentWith(quiz,["p3"]);
  const twice=shareAssessmentWith(once,["p3","p4"]);
  assert.deepEqual(assessmentClassIds(twice).sort(),["p2","p3","p4"]);
  assert.equal(new Set(twice.classIds).size,twice.classIds.length);
});
test("the home class never ends up duplicated in classIds",()=>{
  const shared=shareAssessmentWith(quiz,["p2","p3"]);
  assert.equal(shared.classIds.includes("p2"),false);
  assert.deepEqual(assessmentClassIds(shared).sort(),["p2","p3"]);
});
test("sharing with nothing leaves the assessment untouched",()=>{
  assert.equal(shareAssessmentWith(quiz,[]),quiz);
});
test("questions and answer key travel; student work does not",()=>{
  const withWork={...quiz,
    questions:[{id:"q1",number:1,text:"t",passage:"",answer:"2",standard:"",secondary:"",skill:"",
      dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false}],
    responses:[{id:"r1",studentId:"s1",questionId:"q1",answer:"2",correct:true,match:100,
      misconception:"",confidence:99,verified:true}]};
  const shared=shareAssessmentWith(withWork,["p3"]);
  // Same assessment object, so the questions are literally the same ones.
  assert.deepEqual(shared.questions,withWork.questions);
  // Responses ride along on the record, but each class only ever sees its own
  // students, so a period never shows another period's work.
  assert.deepEqual(shared.responses,withWork.responses);
});

// A reteach group made from one wrong answer. Nine children who all wrote
// "9.2" did not make nine mistakes -- they made one, and it has a name.
const {reteachGroup,withReteachGroup}=bundle("lib/teacher-workflow.ts");
const q4={id:"q4",number:4,text:"How many more?",passage:"",answer:"5.2",standard:"7.RP.3",
  secondary:"",skill:"percent change",dok:2,alignment:100,confidence:100,level:"On grade",
  reasoning:"",verified:true,excluded:false};

test("a reteach group is named after the mistake, not the standard",()=>{
  const g=reteachGroup("c1",q4,{answer:"9.2",studentIds:["s1","s2","s3"]});
  assert.match(g.name,/Q4/);
  assert.match(g.name,/9\.2/);
  assert.equal(g.standard,"7.RP.3","the standard still rides along for lesson planning");
  assert.deepEqual(g.studentIds,["s1","s2","s3"]);
  assert.equal(g.classId,"c1");
});
test("a group of blanks says so rather than naming an empty answer",()=>{
  assert.match(reteachGroup("c1",q4,{answer:"   ",studentIds:["s1"]}).name,/left blank/);
});
test("a question with no standard still makes a usable group",()=>{
  const g=reteachGroup("c1",{...q4,standard:""},{answer:"9.2",studentIds:["s1"]});
  assert.equal(g.standard,"");
  assert.match(g.name,/Q4/);
});
test("the same student is never listed twice in a group",()=>{
  assert.deepEqual(reteachGroup("c1",q4,{answer:"9.2",studentIds:["s1","s1","s2"]}).studentIds,["s1","s2"]);
});
test("making the same reteach group twice replaces it rather than stacking",()=>{
  const first=reteachGroup("c1",q4,{answer:"9.2",studentIds:["s1","s2"]});
  const again=reteachGroup("c1",q4,{answer:"9.2",studentIds:["s1","s2","s3"]});
  const groups=withReteachGroup(withReteachGroup([],first),again);
  assert.equal(groups.length,1);
  assert.deepEqual(groups[0].studentIds,["s1","s2","s3"]);
});
test("a reteach group leaves other groups and other classes alone",()=>{
  const mine=reteachGroup("c1",q4,{answer:"9.2",studentIds:["s1"]});
  const otherQuestion=reteachGroup("c1",{...q4,number:7},{answer:"9.2",studentIds:["s2"]});
  const otherClass={id:"g9",classId:"c2",name:mine.name,standard:"",studentIds:["s9"]};
  const groups=withReteachGroup(withReteachGroup([otherClass],otherQuestion),mine);
  assert.equal(groups.length,3,"an unrelated group was dropped");
  assert.ok(groups.some(g=>g.classId==="c2"),"another class's group was dropped");
});

// A student's progress across every standard, and which standard their page
// should open on.
const {progressOverTime,defaultFocusFor}=bundle("lib/teacher-workflow.ts");
const ev=(standard,score,date,source="Exit ticket")=>({id:standard+date+score,standard,score,date,source});
const withEvidence=(evidence)=>({id:"s1",classId:"c1",name:"Maria G.",color:"#000",evidence,notes:""});

test("several records on one day are one point, averaged",()=>{
  const p=progressOverTime(withEvidence([
    ev("7.RP.3",80,"2026-09-01"),ev("7.EE.1",60,"2026-09-01"),
  ]));
  assert.equal(p.length,1);
  assert.equal(p[0].score,70);
  assert.equal(p[0].records,2);
  assert.deepEqual(p[0].standards,["7.EE.1","7.RP.3"]);
});
test("points come back oldest first, whatever order they were recorded",()=>{
  const p=progressOverTime(withEvidence([
    ev("7.RP.3",90,"2026-09-15"),ev("7.RP.3",50,"2026-09-01"),ev("7.RP.3",70,"2026-09-08"),
  ]));
  assert.deepEqual(p.map(x=>x.date),["2026-09-01","2026-09-08","2026-09-15"]);
  assert.deepEqual(p.map(x=>x.score),[50,70,90]);
});
test("a student with no evidence has no progress line rather than a zero",()=>{
  assert.deepEqual(progressOverTime(withEvidence([])),[]);
});
test("a record with no date is skipped instead of making an undefined point",()=>{
  const p=progressOverTime(withEvidence([ev("7.RP.3",80,""),ev("7.RP.3",90,"2026-09-01")]));
  assert.equal(p.length,1);
  assert.equal(p[0].date,"2026-09-01");
});
test("a student page opens on the standard they were last assessed on",()=>{
  const s=withEvidence([ev("7.EE.1",60,"2026-09-01"),ev("7.RP.3",80,"2026-09-15")]);
  assert.equal(defaultFocusFor(s,"7.AA.1"),"7.RP.3");
});
test("a student with no evidence falls back to the catalogue's first standard",()=>{
  assert.equal(defaultFocusFor(withEvidence([]),"7.AA.1"),"7.AA.1");
  assert.equal(defaultFocusFor(undefined,"7.AA.1"),"7.AA.1");
});
test("evidence with no standard never becomes the opening focus",()=>{
  const s=withEvidence([ev("",95,"2026-09-20"),ev("7.RP.3",80,"2026-09-15")]);
  assert.equal(defaultFocusFor(s,"7.AA.1"),"7.RP.3");
});
