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
