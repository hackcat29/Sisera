import { auth } from "../../../auth";
import { PageHeader } from "../../../components/page-header";
import { SocialFeedBrowser } from "../../../components/social-feed-browser";
import { getSocialFeed } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const session = await auth();
  const feed = await getSocialFeed({
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  }).catch(() => null);
  const posts = feed?.data ?? [];
  return (
    <div className="min-h-full">
      <PageHeader
        eyebrow="Public community observations"
        title="Social feeds"
        description="Search public community posts and inspect original sources. Asset mentions are leads for research, not verified trading signals."
      />
      <div className="p-4 md:p-6">
        <SocialFeedBrowser posts={posts} sources={feed?.sources ?? {}} />
        {!feed && (
          <p className="mt-3 text-xs text-amber-200">
            Social feed service is temporarily unavailable.
          </p>
        )}
      </div>
    </div>
  );
}
