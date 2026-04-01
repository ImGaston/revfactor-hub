"use client"

import { useState } from "react"
import { Lightbulb, BarChart3 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IdeasView } from "./ideas-view"
import { RoadmapKanban } from "./roadmap-kanban"
import type { Post, Board, Tag } from "@/lib/types"

type RoadmapTabsProps = {
  posts: Post[]
  boards: Board[]
  tags: Tag[]
}

export function RoadmapTabs({ posts, boards, tags }: RoadmapTabsProps) {
  const [tab, setTab] = useState("ideas")

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="ideas" className="gap-1.5">
          <Lightbulb className="size-4" />
          Ideas
        </TabsTrigger>
        <TabsTrigger value="roadmap" className="gap-1.5">
          <BarChart3 className="size-4" />
          Roadmap
        </TabsTrigger>
      </TabsList>
      <TabsContent value="ideas" className="mt-4">
        <IdeasView posts={posts} boards={boards} tags={tags} />
      </TabsContent>
      <TabsContent value="roadmap" className="mt-4">
        <RoadmapKanban posts={posts} boards={boards} tags={tags} />
      </TabsContent>
    </Tabs>
  )
}
