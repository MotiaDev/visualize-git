import { ApiRouteConfig, Handlers } from 'motia';

export interface ContributionStats {
  totalCommits: number;
  totalPullRequests: number;
  totalIssues: number;
  totalReviews: number;
  activityPatterns: {
    busiestDay: { day: string; count: number };
    peakHours: { hour: number; count: number }[];
    peakMonth: { month: string; count: number };
    weekdayDistribution: { day: string; count: number }[];
    hourlyDistribution: { hour: number; count: number }[];
  };
  topContributors: {
    login: string;
    avatar: string;
    commits: number;
    pullRequests: number;
    issues: number;
  }[];
  recentCommitters: {
    login: string;
    avatar: string;
    commits: number;
    lastCommitDate: string;
  }[];
}

// Bot accounts and automated users to filter out
const BOT_PATTERNS = [
  'actions-user',
  'github-actions',
  'dependabot',
  'renovate',
  'coderabbitai',
  'coderabbit',
  'claude',
  'cursor',
  'copilot',
  'semantic-release-bot',
  'greenkeeper',
  'snyk-bot',
  'imgbot',
  'allcontributors',
  'codecov',
  'sonarcloud',
  'netlify',
  'vercel',
  'deepsource',
  'mergify',
  'stale',
  'probot',
  '[bot]',
];

const isBot = (login: string): boolean => {
  const lowerLogin = login.toLowerCase();
  return BOT_PATTERNS.some(pattern => 
    lowerLogin.includes(pattern.toLowerCase()) || lowerLogin.endsWith('[bot]')
  );
};

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'Get Contributions',
  description: 'Fetches comprehensive contribution statistics including PRs, issues, reviews, and activity patterns',
  path: '/api/github/contributions/:owner/:repo',
  method: 'GET',
  queryParams: [
    { name: 'token', description: 'GitHub personal access token' },
  ],
  emits: [],
  flows: ['github'],
};

export const handler: Handlers[keyof Handlers] = async (req, ctx) => {
  const { owner, repo } = req.pathParams as Record<string, string>;
  const queryParams = req.queryParams as Record<string, string>;
  const token = queryParams.token || process.env.GITHUB_TOKEN;

  ctx.logger.info('[get-contributions] Fetching contribution stats', { owner, repo });

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitGalaxy',
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    // Use GitHub Search API to get accurate total counts
    // Also fetch contributors stats and recent commits for activity patterns
    const [
      prSearchRes,
      issueSearchRes,
      contributorsRes,
      commitsRes,
      repoRes,
    ] = await Promise.all([
      // Search API returns total_count for PRs
      fetch(`https://api.github.com/search/issues?q=repo:${owner}/${repo}+type:pr`, { headers }),
      // Search API returns total_count for issues (excluding PRs)
      fetch(`https://api.github.com/search/issues?q=repo:${owner}/${repo}+type:issue`, { headers }),
      // Contributors stats (paginated, but gives commit counts)
      fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`, { headers }),
      // Recent commits for activity patterns (get more pages for better patterns)
      fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`, { headers }),
      // Repo info for additional stats
      fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
    ]);

    // Check for errors
    const responses = [prSearchRes, issueSearchRes, contributorsRes, commitsRes, repoRes];
    for (const res of responses) {
      if (!res.ok && res.status !== 403) { // 403 might be rate limit, we can work around it
        const errorText = await res.text();
        ctx.logger.error('[get-contributions] GitHub API error', { status: res.status, error: errorText, url: res.url });
      }
    }

    // Parse responses (handle potential failures gracefully)
    const prSearch = prSearchRes.ok ? await prSearchRes.json() : { total_count: 0, items: [] };
    const issueSearch = issueSearchRes.ok ? await issueSearchRes.json() : { total_count: 0, items: [] };
    const contributors = contributorsRes.ok ? await contributorsRes.json() : [];
    const commits = commitsRes.ok ? await commitsRes.json() : [];
    const repoInfo = repoRes.ok ? await repoRes.json() : {};

    // Get total commit count from contributors (sum of all contributions)
    const totalCommits = Array.isArray(contributors) 
      ? contributors.reduce((sum: number, c: any) => sum + (c.contributions || 0), 0)
      : 0;

    // Total PRs and issues from search API
    const totalPRs = prSearch.total_count || 0;
    const totalIssues = issueSearch.total_count || 0;

    // Calculate activity patterns from recent commits (sample data)
    const hourlyDistribution: number[] = new Array(24).fill(0);
    const weekdayDistribution: number[] = new Array(7).fill(0);
    const monthlyDistribution: Record<string, number> = {};

    // Process commits for activity patterns
    if (Array.isArray(commits)) {
      commits.forEach((commit: any) => {
        const date = new Date(commit.commit?.author?.date || commit.commit?.committer?.date);
        if (!isNaN(date.getTime())) {
          hourlyDistribution[date.getHours()]++;
          weekdayDistribution[date.getDay()]++;
          
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          monthlyDistribution[monthKey] = (monthlyDistribution[monthKey] || 0) + 1;
        }
      });
    }

    // Build contributor stats from the contributors API (accurate commit counts)
    // Filter out bots and automated accounts
    const contributorData: { login: string; avatar: string; commits: number; pullRequests: number; issues: number }[] = [];
    
    if (Array.isArray(contributors)) {
      contributors.forEach((contributor: any) => {
        const login = contributor.login || 'Unknown';
        // Skip bots
        if (isBot(login)) return;
        
        contributorData.push({
          login,
          avatar: contributor.avatar_url || '',
          commits: contributor.contributions || 0,
          pullRequests: 0,
          issues: 0,
        });
      });
    }

    // Count PR authors from search results (items array has the actual PRs)
    const prAuthors: Record<string, number> = {};
    if (prSearch.items && Array.isArray(prSearch.items)) {
      prSearch.items.forEach((pr: any) => {
        const login = pr.user?.login || 'Unknown';
        if (!isBot(login)) {
          prAuthors[login] = (prAuthors[login] || 0) + 1;
        }
      });
    }

    // Count issue authors from search results
    const issueAuthors: Record<string, number> = {};
    if (issueSearch.items && Array.isArray(issueSearch.items)) {
      issueSearch.items.forEach((issue: any) => {
        const login = issue.user?.login || 'Unknown';
        if (!isBot(login)) {
          issueAuthors[login] = (issueAuthors[login] || 0) + 1;
        }
      });
    }

    // Merge PR and issue counts into contributor data
    contributorData.forEach(contributor => {
      contributor.pullRequests = prAuthors[contributor.login] || 0;
      contributor.issues = issueAuthors[contributor.login] || 0;
    });

    // Add contributors who only have PRs/issues but no commits
    Object.keys(prAuthors).forEach(login => {
      if (!contributorData.find(c => c.login === login) && !isBot(login)) {
        contributorData.push({
          login,
          avatar: '',
          commits: 0,
          pullRequests: prAuthors[login],
          issues: issueAuthors[login] || 0,
        });
      }
    });

    // Sort by total contributions
    contributorData.sort((a, b) => 
      (b.commits + b.pullRequests + b.issues) - (a.commits + a.pullRequests + a.issues)
    );

    // Build recent committers from last 7 days (from commits data)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentCommitterMap: Record<string, { login: string; avatar: string; commits: number; lastCommitDate: string }> = {};
    
    if (Array.isArray(commits)) {
      commits.forEach((commit: any) => {
        const login = commit.author?.login || commit.commit?.author?.name || 'Unknown';
        const commitDate = new Date(commit.commit?.author?.date || commit.commit?.committer?.date);
        
        // Skip bots and commits older than 7 days
        if (isBot(login) || isNaN(commitDate.getTime()) || commitDate < sevenDaysAgo) return;
        
        if (!recentCommitterMap[login]) {
          recentCommitterMap[login] = {
            login,
            avatar: commit.author?.avatar_url || '',
            commits: 0,
            lastCommitDate: commitDate.toISOString(),
          };
        }
        recentCommitterMap[login].commits++;
        
        // Update last commit date if this is more recent
        if (commitDate.toISOString() > recentCommitterMap[login].lastCommitDate) {
          recentCommitterMap[login].lastCommitDate = commitDate.toISOString();
        }
      });
    }

    // Sort recent committers by commit count, then by most recent
    const recentCommitters = Object.values(recentCommitterMap)
      .sort((a, b) => b.commits - a.commits || new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());

    // Calculate peak patterns
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayData = weekdayDistribution.map((count, i) => ({ day: dayNames[i], count }));
    const maxWeekday = Math.max(...weekdayDistribution);
    const busiestDayIndex = maxWeekday > 0 ? weekdayDistribution.indexOf(maxWeekday) : 0;
    
    const hourlyData = hourlyDistribution.map((count, hour) => ({ hour, count }));
    const peakHours = [...hourlyData]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const monthEntries = Object.entries(monthlyDistribution);
    const peakMonthEntry = monthEntries.length > 0 
      ? monthEntries.reduce((a, b) => a[1] > b[1] ? a : b)
      : ['N/A', 0];

    // Estimate reviews based on merged PRs ratio (rough estimate)
    // A typical ratio is about 1.5-2 reviews per merged PR
    const estimatedMergedPRs = Math.floor(totalPRs * 0.7); // ~70% of PRs get merged
    const estimatedReviews = Math.floor(estimatedMergedPRs * 1.5);

    const stats: ContributionStats = {
      totalCommits,
      totalPullRequests: totalPRs,
      totalIssues,
      totalReviews: estimatedReviews,
      activityPatterns: {
        busiestDay: { day: dayNames[busiestDayIndex], count: weekdayDistribution[busiestDayIndex] },
        peakHours,
        peakMonth: { month: peakMonthEntry[0] as string, count: peakMonthEntry[1] as number },
        weekdayDistribution: weekdayData,
        hourlyDistribution: hourlyData,
      },
      topContributors: contributorData.slice(0, 5), // Top 5 contributors only
      recentCommitters: recentCommitters.slice(0, 5), // Last 7 days committers
    };

    ctx.logger.info('[get-contributions] Successfully fetched contribution stats', { 
      owner, 
      repo,
      commits: stats.totalCommits,
      prs: stats.totalPullRequests,
      issues: stats.totalIssues,
      topContributors: stats.topContributors.length,
      recentCommitters: stats.recentCommitters.length,
    });

    return {
      status: 200,
      body: stats,
    };
  } catch (error: any) {
    ctx.logger.error('[get-contributions] Error fetching contributions', { error: error.message });
    return {
      status: 500,
      body: { error: error.message || 'Failed to fetch contributions' },
    };
  }
};

