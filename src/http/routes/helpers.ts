import type { Project, ScheduledTask } from "../../contracts/index.js"

export function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
export function scheduledData(tasks: ScheduledTask[]): { tasks: ScheduledTask[] } { return { tasks } }
