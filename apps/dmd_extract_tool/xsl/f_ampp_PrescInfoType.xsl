<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<?ampp_PrescInfoType?>
<xsl:template match="//PRESCRIB_INFO">
<xsl:value-of select="APPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SCHED_2"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ACBS"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PADM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="FP10_MDA"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SCHED_1"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="HOSP"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NURSE_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ENURSE_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DENT_F"/>
<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
