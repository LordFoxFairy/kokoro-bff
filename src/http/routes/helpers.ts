import type { Project, ScheduledTaskDetails } from "../../contracts/index.js"

export function projectData(projects: Project[]): { projects: Project[] } { return { projects } }
export function scheduledData(tasks: ScheduledTaskDetails[]): { tasks: ScheduledTaskDetails[] } { return { tasks } }
