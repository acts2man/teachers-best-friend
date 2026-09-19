import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
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
