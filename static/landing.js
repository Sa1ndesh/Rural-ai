/* ══════════════════════════════════════════
   RuralX AI – Landing Page JavaScript
   Particle canvas · counter animation
   scroll effects · smooth UX
   ══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

    /* ── Particle Canvas ── */
    const canvas = document.getElementById('particleCanvas');
    const ctx    = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x  = Math.random() * W;
            this.y  = Math.random() * H;
            this.r  = Math.random() * 1.5 + 0.3;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
            this.a  = Math.random() * 0.5 + 0.1;
            this.hue = Math.random() > 0.5 ? 245 : 190; // purple or cyan
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${this.hue}, 80%, 70%, ${this.a})`;
            ctx.fill();
        }
    }

    // Create particles
    for (let i = 0; i < 120; i++) particles.push(new Particle());

    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d < 100) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(99,102,241,${0.06 * (1 - d/100)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function animateParticles() {
        ctx.clearRect(0, 0, W, H);
        drawConnections();
        particles.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animateParticles);
    }
    animateParticles();

    /* ── Navbar Scroll Effect ── */
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    /* ── Intersection Observer (fade-in on scroll) ── */
    const io = new IntersectionObserver((entries) => {
        entries.forEach((entry, idx) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, idx * 80);
                io.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.stat-card, .feature-card, .step-card').forEach(el => io.observe(el));

    /* ── Counter Animation ── */
    function animateCounter(el, target, suffix = '') {
        const duration = 1800;
        const start    = performance.now();
        const isDecimal = target % 1 !== 0;

        function tick(now) {
            const t     = Math.min((now - start) / duration, 1);
            const ease  = 1 - Math.pow(1 - t, 3);
            const val   = target * ease;
            el.textContent = isDecimal ? val.toFixed(1) : Math.floor(val);
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    const counterIO = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card   = entry.target;
                const count  = parseFloat(card.dataset.count);
                const valEl  = card.querySelector('.count-val');
                animateCounter(valEl, count);
                counterIO.unobserve(card);
            }
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-card[data-count]').forEach(el => counterIO.observe(el));

    /* ── Smooth Scroll ── */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    /* ── Auth redirect check ── */
    // If user is already logged in, redirect to /app
    const sbUrl  = 'https://jdhsnfjqmixaywphlqdc.supabase.co';
    const sbKey  = 'sb_publishable_mx8a_8WtYpUModWJG5GFJA_wlT8nKGF';

    if (window.supabase) {
        const sb = window.supabase.createClient(sbUrl, sbKey);
        sb.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                const navGetStarted = document.getElementById('navGetStarted');
                const heroGetStarted = document.getElementById('heroGetStarted');
                const ctaGetStarted = document.getElementById('ctaGetStarted');
                const navSignIn = document.getElementById('navSignIn');
                if (navGetStarted)  navGetStarted.href = '/app';
                if (navGetStarted)  navGetStarted.textContent = 'Open App';
                if (heroGetStarted) heroGetStarted.href = '/app';
                if (ctaGetStarted)  ctaGetStarted.href = '/app';
                if (navSignIn)      navSignIn.style.display = 'none';
            }
        });
    }
});
