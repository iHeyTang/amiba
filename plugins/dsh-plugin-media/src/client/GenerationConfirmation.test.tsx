// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {GenerationConfirmation} from './GenerationConfirmation.js';
afterEach(cleanup);
function props() {return {request:{questions:[{id:'amiba.media.confirm',question:'Review',detail:JSON.stringify({provider:'fixture',model:'video',price:'费用未知',parameters:{duration:5,resolution:'720p',prompt:'A lake'}})}]},respond:vi.fn(),cancel:vi.fn(),inFlight:false,error:null};}
it('shows the concrete plan and only emits approval on the confirmation button',()=>{
 const p=props();render(<GenerationConfirmation {...p as any}/>);
 expect(screen.getByText('720p')).toBeTruthy();expect(p.respond).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'确认生成'}));expect(p.respond).toHaveBeenCalledWith([{id:'amiba.media.confirm',selected:['确认生成']}]);
});
it('editing disables approval and returns changes instead of authorizing the old plan',()=>{
 const p=props();render(<GenerationConfirmation {...p as any}/>);
 fireEvent.click(screen.getByRole('button',{name:'调整参数'}));
 expect((screen.getByRole('button',{name:'确认生成'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'改为三秒'}});
 fireEvent.click(screen.getByRole('button',{name:'更新方案'}));expect(p.respond).toHaveBeenCalledWith([{id:'amiba.media.confirm',selected:['调整参数'],custom:'改为三秒'}]);
});
