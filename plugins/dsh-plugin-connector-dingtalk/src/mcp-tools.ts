/** Exact contacts/calendar/tasks wire tools from dingtalk-mcp 1.1.21. */
export const dingtalkMcpTools = [
  {
    "name": "currentDateTime",
    "title": "获取当前日期和时间"
  },
  {
    "name": "searchUser",
    "title": "根据姓名搜索钉钉通讯录用户的userId。"
  },
  {
    "name": "getUserDetailByUserId",
    "title": "查询用户详情 - 根据userId获取用户的详细信息，包含用户的unionId。"
  },
  {
    "name": "getUserIdByMobile",
    "title": "根据手机号获取用户的userId。"
  },
  {
    "name": "getUserIdByUnionId",
    "title": "根据unionId获取用户的userId。"
  },
  {
    "name": "getDepartmentUsersByDepId",
    "title": "获取指定部门下的所有成员的userId。"
  },
  {
    "name": "createEvent",
    "title": "创建一个新的日程，支持设置时间、地点、参与者、提醒、重复规则等"
  },
  {
    "name": "updateEvent",
    "title": "修改已存在的日程信息"
  },
  {
    "name": "deleteEvent",
    "title": "删除指定的日程"
  },
  {
    "name": "getEvent",
    "title": "查询单个日程的详细信息"
  },
  {
    "name": "addAttendee",
    "title": "添加日程参与者，每次最多支持操作500人"
  },
  {
    "name": "removeAttendee",
    "title": "删除日程参与者，每次最多支持操作500人"
  },
  {
    "name": "getAttendees",
    "title": "获取日程参与者列表"
  },
  {
    "name": "getCalendarView",
    "title": "查询日程视图，按时间范围获取日程列表"
  },
  {
    "name": "queryTasks",
    "title": "查询钉钉待办/任务列表"
  },
  {
    "name": "deleteTask",
    "title": "删除钉钉待办"
  },
  {
    "name": "createTask",
    "title": "创建待办"
  },
  {
    "name": "updateTask",
    "title": "更新待办"
  },
  {
    "name": "updateExecutorsTaskStatus",
    "title": "更新执行人待办状态"
  }
];
