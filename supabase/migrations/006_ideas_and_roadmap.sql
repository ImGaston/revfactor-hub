-- ============================================================
-- 006: Ideas & Roadmap system
-- Replaces roadmap_items with posts, adds boards, tags,
-- comments, upvotes, and reactions.
-- ============================================================

-- Boards
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📋',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Posts (replaces roadmap_items)
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'next', 'in_progress', 'limited_release', 'completed')),
  board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
  eta DATE,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Post ↔ Tag junction
CREATE TABLE post_tags (
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Upvotes (one per user per post)
CREATE TABLE post_upvotes (
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

-- Comments (threaded via parent_comment_id)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Comment reactions (like/dislike, one per user per comment)
CREATE TABLE comment_reactions (
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
  PRIMARY KEY (comment_id, user_id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_board_id ON posts(board_id);
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_post_tags_post ON post_tags(post_id);
CREATE INDEX idx_post_tags_tag ON post_tags(tag_id);
CREATE INDEX idx_post_upvotes_post ON post_upvotes(post_id);
CREATE INDEX idx_post_upvotes_user ON post_upvotes(user_id);
CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comment_reactions_comment ON comment_reactions(comment_id);

-- ============================================================
-- RLS — all authenticated users can CRUD
-- ============================================================
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_upvotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;

-- boards
CREATE POLICY "Authenticated users can view boards"
  ON boards FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert boards"
  ON boards FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update boards"
  ON boards FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete boards"
  ON boards FOR DELETE TO authenticated USING (true);

-- tags
CREATE POLICY "Authenticated users can view tags"
  ON tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tags"
  ON tags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tags"
  ON tags FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete tags"
  ON tags FOR DELETE TO authenticated USING (true);

-- posts
CREATE POLICY "Authenticated users can view posts"
  ON posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert posts"
  ON posts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update posts"
  ON posts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete posts"
  ON posts FOR DELETE TO authenticated USING (true);

-- post_tags
CREATE POLICY "Authenticated users can view post_tags"
  ON post_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert post_tags"
  ON post_tags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete post_tags"
  ON post_tags FOR DELETE TO authenticated USING (true);

-- post_upvotes
CREATE POLICY "Authenticated users can view post_upvotes"
  ON post_upvotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert post_upvotes"
  ON post_upvotes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete post_upvotes"
  ON post_upvotes FOR DELETE TO authenticated USING (true);

-- comments
CREATE POLICY "Authenticated users can view comments"
  ON comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert comments"
  ON comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update comments"
  ON comments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete comments"
  ON comments FOR DELETE TO authenticated USING (true);

-- comment_reactions
CREATE POLICY "Authenticated users can view comment_reactions"
  ON comment_reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert comment_reactions"
  ON comment_reactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete comment_reactions"
  ON comment_reactions FOR DELETE TO authenticated USING (true);

-- ============================================================
-- View: post with aggregated counts
-- ============================================================
CREATE OR REPLACE VIEW post_with_counts AS
SELECT
  p.*,
  COALESCE(u.upvote_count, 0)::integer AS upvote_count,
  COALESCE(c.comment_count, 0)::integer AS comment_count
FROM posts p
LEFT JOIN (
  SELECT post_id, COUNT(*)::integer AS upvote_count
  FROM post_upvotes GROUP BY post_id
) u ON u.post_id = p.id
LEFT JOIN (
  SELECT post_id, COUNT(*)::integer AS comment_count
  FROM comments GROUP BY post_id
) c ON c.post_id = p.id;

-- ============================================================
-- Migrate data from roadmap_items → posts
-- ============================================================
INSERT INTO posts (id, title, description, status, sort_order, created_at, updated_at)
SELECT
  id, title, description,
  CASE status
    WHEN 'proposed' THEN 'backlog'
    WHEN 'planned' THEN 'next'
    WHEN 'in_progress' THEN 'in_progress'
    WHEN 'done' THEN 'completed'
    ELSE 'backlog'
  END,
  sort_order, created_at, updated_at
FROM roadmap_items;

-- ============================================================
-- Seed default boards
-- ============================================================
INSERT INTO boards (name, icon, description, sort_order) VALUES
  ('Product', '🚀', 'Product features and improvements', 0),
  ('Growth', '📈', 'Growth and marketing initiatives', 1),
  ('Operations', '⚙️', 'Operational improvements', 2),
  ('Tech', '💻', 'Technical infrastructure', 3),
  ('Integrations', '🔗', 'Third-party integrations', 4);

-- ============================================================
-- Seed default tags
-- ============================================================
INSERT INTO tags (name, color) VALUES
  ('Product', '#3b82f6'),
  ('Growth', '#22c55e'),
  ('Operations', '#f59e0b'),
  ('Tech', '#8b5cf6'),
  ('Integrations', '#ec4899');

-- ============================================================
-- Drop old table
-- ============================================================
DROP TABLE roadmap_items;
