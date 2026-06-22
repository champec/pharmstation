<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<xsl:template match="//VPI">
<xsl:value-of select="VPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ISID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="BASIS_STRNTCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="BS_SUBID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="STRNT_NMRTR_VAL"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="STRNT_NMRTR_UOMCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="STRNT_DNMTR_VAL"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="STRNT_DNMTR_UOMCD"/>

<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
