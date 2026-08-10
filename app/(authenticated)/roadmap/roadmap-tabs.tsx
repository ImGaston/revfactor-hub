"use client"

import { useState } from "react"
import { FolderKanban, Columns3 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProjectsView } from "./projects-view"
import { RoadmapKanban } from "./roadmap-kanban"
import type { Post, Board, Tag, RoadmapProject } from "@/lib/types"

type RoadmapTabsProps = {
  posts: Post[]
  projects: RoadmapProject[]
  boards: Board[]
  tags: Tag[]
}

export function RoadmapTabs({
  posts,
  projects,
  boards,
  tags,
}: RoadmapTabsProps) {
  const [tab, setTab] = useState("projects")
  const [selectedProjectId, setSelectedProjectId] = useState("all")

  function openProjectBoard(projectId: string) {
    setSelectedProjectId(projectId)
    setTab("tasks")
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="projects">
          <FolderKanban data-icon="inline-start" />
          Projects
        </TabsTrigger>
        <TabsTrigger value="tasks">
          <Columns3 data-icon="inline-start" />
          Task board
        </TabsTrigger>
      </TabsList>
      <TabsContent value="projects" className="mt-4">
        <ProjectsView
          projects={projects}
          posts={posts}
          boards={boards}
          onOpenProjectBoard={openProjectBoard}
        />
      </TabsContent>
      <TabsContent value="tasks" className="mt-4">
        <RoadmapKanban
          posts={posts}
          projects={projects}
          boards={boards}
          tags={tags}
          selectedProjectId={selectedProjectId}
          onSelectedProjectChange={setSelectedProjectId}
        />
      </TabsContent>
    </Tabs>
  )
}
